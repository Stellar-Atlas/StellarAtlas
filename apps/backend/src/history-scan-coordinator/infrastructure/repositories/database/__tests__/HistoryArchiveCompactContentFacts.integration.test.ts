import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { contentFactsForStorage } from '../HistoryArchiveCompactContentFacts.js';
import {
	recordHistoryArchiveContentEvidence,
	type PreparedContentCompletion
} from '../HistoryArchiveContentReuseWrite.js';
import { markHistoryArchiveObjectsVerified } from '../HistoryArchiveObjectLeaseWrite.js';
import { historyArchiveRetainedRemoteFindingSql } from '../HistoryArchiveRetainedRemoteFindingSql.js';
import { mapPublicVerificationFacts } from '../../../mappers/PublicArchiveObjectFactsMapper.js';
import {
	createProofDataSource,
	saveProofFixture,
	proofArchiveUrl,
	proofCheckpointLedger,
	refreshAndLoadProof
} from './HistoryArchiveCheckpointProofFixture.js';
import type { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
jest.setTimeout(90_000);
type Category = 'ledger' | 'transactions' | 'results';
interface ReuseFixture {
	readonly target: HistoryArchiveObject;
	readonly source: HistoryArchiveObject;
	readonly prepared: PreparedContentCompletion;
}
describe('compact shared category facts in PostgreSQL', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let proofs: TypeOrmHistoryArchiveCheckpointProofRepository;
	let fixtures: ReuseFixture[];
	const previousFlag =
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource: db, repository: proofs } = await createProofDataSource(
			postgres.url
		));
		await db.query(historyArchiveRetainedRemoteFindingSql);
		await db.query(
			`alter table history_archive_object_ready drop constraint "UQ_history_archive_object_ready_archive"`
		);
		await db.query(`alter table history_archive_object_ready
			add column if not exists "dispatchToken" uuid,
			add column if not exists "claimAttempt" integer,
			add column if not exists "publishedAt" timestamptz`);
	});
	afterAll(async () => {
		if (previousFlag === undefined)
			delete process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED;
		else
			process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = previousFlag;
		if (db?.isInitialized) await db.destroy();
		if (postgres !== undefined) await postgres.stop();
	});
	beforeEach(async () => {
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'true';
		await initializeFixtures();
	});
	async function initializeFixtures(empty = false): Promise<void> {
		await db.query(`truncate history_archive_object_queue,
			history_archive_checkpoint_content, history_archive_checkpoint_proof,
			history_archive_checkpoint_proof_refresh_queue,
			history_archive_checkpoint_bucket_dependency restart identity cascade`);
		await saveProofFixture(db);
		if (empty) {
			const objects = db.getRepository(HistoryArchiveObject);
			for (const ledger of await objects.findBy({ objectType: 'ledger' })) {
				ledger.verificationFacts = {
					ledgerCategory: {
						...ledger.verificationFacts!.ledgerCategory!,
						ledgers: ledger.verificationFacts!.ledgerCategory!.ledgers.map(
							(fact) => ({
								...fact,
								protocolVersion: 19,
								ledgerHeaderHash: createHash('sha256')
									.update(String(fact.ledger))
									.digest('base64'),
								previousLedgerHeaderHash: createHash('sha256')
									.update(String(fact.ledger - 1))
									.digest('base64'),
								transactionSetHash: createHash('sha256')
									.update(
										createHash('sha256')
											.update(String(fact.ledger - 1))
											.digest()
									)
									.digest('base64'),
								transactionResultSetHash:
									'3z9hmASpL9tAVxktxD3XSOp3itxSvEmM6AUkwBS4ERk='
							})
						)
					}
				};
				await objects.save(ledger);
			}
			for (const kind of ['transactions', 'results'] as const) {
				const object = await objects.findOneByOrFail({
					objectType: kind,
					checkpointLedger: proofCheckpointLedger
				});
				object.verificationFacts = {
					[`${kind}Category`]: {
						entryCount: 0,
						ledgers: [],
						sourceUrl: object.objectUrl
					}
				};
				await objects.save(object);
			}
		}
		fixtures = [];
		for (const kind of ['ledger', 'transactions', 'results'] as const) {
			fixtures.push(await createReuse(kind, proofCheckpointLedger));
		}
		fixtures.push(await createReuse('ledger', proofCheckpointLedger - 64));
	}
	it('writes smaller compact facts and verifies them with an existing compact predecessor', async () => {
		await completeAll();
		await compactLegacyObjects([fixtures[3]!.target.remoteId]);
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			status: 'verified',
			proofFactsComplete: true,
			previousLedgersMatch: true,
			ledgerFactCount: 64,
			transactionFactCount: 64,
			resultFactCount: 64
		});
		for (const fixture of fixtures) {
			const stored = await storedFacts(fixture.target.remoteId);
			const key = fixture.target.objectType + 'Category';
			expect((stored[key] as Record<string, unknown>).ledgers).toBeUndefined();
			expect(stored.contentReference).toMatchObject({ claimAttempt: 1 });
			expect(mapPublicVerificationFacts(stored)).toEqual(
				mapPublicVerificationFacts(fixture.prepared.progress.verificationFacts!)
			);
			const [observation] = await db.query(
				`select "artifactId" from history_archive_content_observation
				where "objectRemoteId"=$1 and "claimAttempt"=1`,
				[fixture.target.remoteId]
			);
			expect(observation.artifactId).toBe(fixture.prepared.reuse!.artifactId);
		}
		const fullBytes = Buffer.byteLength(
			JSON.stringify(fixtures[0]!.prepared.progress.verificationFacts)
		);
		const compactBytes = Buffer.byteLength(
			JSON.stringify(await storedFacts(fixtures[0]!.target.remoteId))
		);
		expect(compactBytes).toBeLessThan(fullBytes / 10);
	});

	it.each([
		['artifact', '{contentReference,artifactId}', randomUUID()],
		['source', '{contentReference,sourceObjectRemoteId}', randomUUID()],
		['attempt', '{contentReference,claimAttempt}', 2],
		['digest', '{content,digest}', 'e'.repeat(64)],
		[
			'representation',
			'{contentReference,contentRepresentation}',
			'canonical-json'
		],
		['version', '{contentReference,derivationVersion}', 2],
		[
			'source URL',
			'{transactionsCategory,sourceUrl}',
			'https://wrong.example/file'
		],
		['summary', '{transactionsCategory,sharedSummary,ledgerCount}', 0]
	])('fails closed for a wrong %s reference', async (_name, path, value) => {
		await completeAll();
		const target = fixtures[1]!.target;
		await db.query(
			`update history_archive_object_queue
			set "verificationFacts"=jsonb_set("verificationFacts", $2::text[], $3::jsonb)
			where "remoteId"=$1`,
			[target.remoteId, path, JSON.stringify(value)]
		);
		expect(await resolved(target.remoteId)).toBeNull();
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			proofFactsComplete: false
		});
	});
	it('does not interpret missing references or missing zero-entry arrays as empty verified categories', async () => {
		await completeAll();
		const target = fixtures[1]!.target;
		await db.query(
			`update history_archive_object_queue set "verificationFacts"=
			jsonb_set("verificationFacts"-'contentReference', '{transactionsCategory,entryCount}', '0')
			where "remoteId"=$1`,
			[target.remoteId]
		);
		expect(await resolved(target.remoteId)).toBeNull();
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			proofFactsComplete: false
		});
	});

	it('requires the target observation at its current attempt', async () => {
		await completeAll();
		await db.query(
			`update history_archive_object_queue set attempts=2 where "remoteId"=$1`,
			[fixtures[1]!.target.remoteId]
		);
		expect(await resolved(fixtures[1]!.target.remoteId)).toBeNull();
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			proofFactsComplete: false
		});
	});

	it('keeps new empty categories full and still proves existing compact empty categories', async () => {
		await initializeFixtures(true);
		await completeAll();
		for (const fixture of fixtures.slice(1, 3)) {
			expect(await storedFacts(fixture.target.remoteId)).toEqual(
				fixture.prepared.progress.verificationFacts
			);
		}
		await compactLegacyObjects(
			fixtures.slice(1, 3).map((f) => f.target.remoteId)
		);
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			status: 'verified',
			proofFactsComplete: true,
			transactionFactCount: 0,
			resultFactCount: 0
		});
		await db.query(
			`update history_archive_object_queue set attempts=2,
			"verificationFacts"=jsonb_set("verificationFacts",'{contentReference,claimAttempt}','2') where "remoteId"=$1`,
			[fixtures[1]!.target.remoteId]
		);
		expect(await resolved(fixtures[1]!.target.remoteId)).toBeNull();
		await db.query(`delete from history_archive_checkpoint_proof`);
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			proofFactsComplete: false
		});
	});
	it('rejects a compact completion whose source artifact lacks its original observation', async () => {
		const fixture = fixtures[0]!;
		const source = fixture.source;
		const nextDigest = 'b'.repeat(64);
		await db.query(
			`update history_archive_object_queue set attempts=2,
			"verificationFacts"=jsonb_set("verificationFacts",'{content,digest}',to_jsonb($2::text)) where "remoteId"=$1`,
			[source.remoteId, nextDigest]
		);
		const [orphan] = await db.query(
			`insert into history_archive_content_artifact
			("objectType","objectKey","checkpointLedger","contentDigest","contentRepresentation","derivationVersion","verificationFacts","sourceObjectRemoteId","sourceClaimAttempt")
			select "objectType","objectKey","checkpointLedger",$2,'uncompressed-xdr',1,
			jsonb_set(history_archive_content_source_neutral_facts("objectType","verificationFacts"),'{content,digest}',to_jsonb($2::text)),"remoteId",2
			from history_archive_object_queue where "remoteId"=$1 returning id`,
			[source.remoteId, nextDigest]
		);
		await expect(
			markHistoryArchiveObjectsVerified(
				db.getRepository(HistoryArchiveObject),
				[
					{
						remoteId: fixture.target.remoteId,
						progress: {
							...fixture.prepared.progress,
							contentReuse: {
								...fixture.prepared.reuse!,
								artifactId: orphan.id as string,
								contentDigest: nextDigest
							}
						}
					}
				]
			)
		).rejects.toThrow('does not match the active claim');
	});

	it('rejects the wrong dispatch token without mutating the valid claim', async () => {
		const fixture = fixtures[0]!;
		expect(
			(
				await markHistoryArchiveObjectsVerified(
					db.getRepository(HistoryArchiveObject),
					[
						{
							remoteId: fixture.target.remoteId,
							progress: {
								...fixture.prepared.progress,
								executionId: randomUUID()
							}
						}
					]
				)
			).size
		).toBe(0);
		expect((await completeAll()).size).toBe(4);
	});

	it('keeps original immutable provenance valid after a source is rechecked', async () => {
		await completeAll();
		await db.query(
			`update history_archive_object_queue set attempts=2,status='failed' where "remoteId"=any($1::uuid[])`,
			[fixtures.map((f) => f.source.remoteId)]
		);
		expect(await refreshAndLoadProof(db, proofs)).toMatchObject({
			status: 'verified',
			proofFactsComplete: true
		});
	});

	it('keeps OFF, fresh parsing, and SCP writes unchanged', async () => {
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'false';
		await completeAll();
		expect(await storedFacts(fixtures[0]!.target.remoteId)).toEqual(
			fixtures[0]!.prepared.progress.verificationFacts
		);
		const fresh = { ...fixtures[0]!.prepared, reuse: null };
		expect(contentFactsForStorage(fresh, true)).toBe(
			fresh.progress.verificationFacts
		);
		const scp = {
			...fixtures[0]!.prepared,
			progress: {
				...fixtures[0]!.prepared.progress,
				verificationFacts: {
					content: fixtures[0]!.prepared.progress.verificationFacts!.content,
					scpCategory: { entryCount: 3, sourceUrl: 'https://scp.example' }
				}
			}
		};
		expect(contentFactsForStorage(scp, true)).toBe(
			scp.progress.verificationFacts
		);
	});

	it('filters stale claims in a mixed batch and does not accept post-commit replay', async () => {
		await db.query(
			`delete from history_archive_object_ready where "objectRemoteId"=$1`,
			[fixtures[1]!.target.remoteId]
		);
		const accepted = await completeAll();
		expect(accepted.has(fixtures[1]!.target.remoteId)).toBe(false);
		expect(accepted.size).toBe(3);
		expect((await completeAll()).size).toBe(0);
	});

	it('rejects forged active artifact identity and compact observations with wrong summaries', async () => {
		const fixture = fixtures[0]!;
		await expect(
			markHistoryArchiveObjectsVerified(
				db.getRepository(HistoryArchiveObject),
				[
					{
						remoteId: fixture.target.remoteId,
						progress: {
							...fixture.prepared.progress,
							contentReuse: {
								...fixture.prepared.reuse!,
								contentDigest: 'f'.repeat(64)
							}
						}
					}
				]
			)
		).rejects.toThrow('does not match the active claim');
		const compact = contentFactsForStorage(fixture.prepared, true)!;
		await expect(
			db.transaction(async (manager) => {
				await manager.query(
					`update history_archive_object_queue set status='verified',attempts=1,
				"verificationFacts"=jsonb_set($2::jsonb,'{ledgerCategory,sharedSummary,ledgerCount}','0') where "remoteId"=$1`,
					[fixture.target.remoteId, JSON.stringify(compact)]
				);
				await recordHistoryArchiveContentEvidence(
					manager,
					fixture.target.remoteId,
					fixture.prepared
				);
			})
		).rejects.toThrow('does not match its artifact');
	});

	async function createReuse(
		kind: Category,
		checkpoint: number
	): Promise<ReuseFixture> {
		const repository = db.getRepository(HistoryArchiveObject);
		const target = await repository.findOneByOrFail({
			archiveUrlIdentity: proofArchiveUrl,
			objectType: kind,
			checkpointLedger: checkpoint
		});
		const key = `${kind}Category` as const;
		const fullFacts = {
			...target.verificationFacts!,
			content: {
				algorithm: 'sha256' as const,
				digest: createHash('sha256')
					.update(kind + checkpoint)
					.digest('hex'),
				representation: 'uncompressed-xdr' as const
			}
		};
		const sourceUrl = target.objectUrl.replace(
			'proof.example',
			'source.example'
		);
		const source = new HistoryArchiveObject({
			archiveUrl: 'https://source.example/archive',
			archiveUrlIdentity: 'https://source.example/archive',
			objectType: kind,
			objectKey: target.objectKey,
			objectOrder: target.objectOrder,
			objectUrl: sourceUrl,
			checkpointLedger: checkpoint,
			status: 'verified'
		});
		source.attempts = 1;
		source.verificationFacts = {
			...fullFacts,
			[key]: { ...fullFacts[key]!, sourceUrl }
		};
		await repository.save(source);
		await recordHistoryArchiveContentEvidence(db.manager, source.remoteId, {
			reuse: null,
			progress: { claimAttempt: 1, verificationFacts: source.verificationFacts }
		});
		const [artifact] = await db.query(
			`select id from history_archive_content_artifact where "sourceObjectRemoteId"=$1`,
			[source.remoteId]
		);
		const executionId = randomUUID();
		await db.query(
			`update history_archive_object_queue set status='pending',attempts=0,"verificationFacts"=null where "remoteId"=$1`,
			[target.remoteId]
		);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"dispatchToken","claimAttempt","publishedAt")
			values($1,$2,2,$3,1,now()) on conflict("objectRemoteId") do update set "dispatchToken"=excluded."dispatchToken","claimAttempt"=1,"publishedAt"=now()`,
			[target.remoteId, target.archiveUrlIdentity, executionId]
		);
		const reuse = {
			artifactId: artifact.id as string,
			contentDigest: fullFacts.content.digest,
			contentRepresentation: 'uncompressed-xdr' as const,
			derivationVersion: 1 as const,
			sourceObjectRemoteId: source.remoteId
		};
		return {
			source,
			target,
			prepared: {
				reuse,
				progress: {
					scheduler: 'broker',
					executionId,
					claimAttempt: 1,
					contentReuse: reuse,
					verificationFacts: fullFacts
				}
			}
		};
	}
	async function completeAll(): Promise<ReadonlySet<string>> {
		return markHistoryArchiveObjectsVerified(
			db.getRepository(HistoryArchiveObject),
			fixtures.map((f) => ({
				remoteId: f.target.remoteId,
				progress: f.prepared.progress
			}))
		);
	}
	async function compactLegacyObjects(ids: string[]): Promise<void> {
		await db.query(
			`update history_archive_object_queue object set "verificationFacts"=
			history_archive_compact_content_facts(artifact."verificationFacts", object."objectType", object."objectUrl", artifact.id, artifact."sourceObjectRemoteId", artifact."derivationVersion", object.attempts)
			from history_archive_content_observation observation join history_archive_content_artifact artifact on artifact.id=observation."artifactId"
			where object."remoteId"=observation."objectRemoteId" and object.attempts=observation."claimAttempt" and object."remoteId"=any($1::uuid[])`,
			[ids]
		);
	}
	async function storedFacts(id: string): Promise<Record<string, unknown>> {
		const [row] = await db.query(
			`select "verificationFacts" from history_archive_object_queue where "remoteId"=$1`,
			[id]
		);
		return row.verificationFacts as Record<string, unknown>;
	}
	async function resolved(id: string): Promise<unknown> {
		const [row] = await db.query(
			`select history_archive_category_ledgers("remoteId",attempts,"objectType","objectKey","checkpointLedger","objectUrl","verificationFacts") as facts from history_archive_object_queue where "remoteId"=$1`,
			[id]
		);
		return row.facts;
	}
});
