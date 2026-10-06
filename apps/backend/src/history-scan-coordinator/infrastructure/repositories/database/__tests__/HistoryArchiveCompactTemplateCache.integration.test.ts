import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { HistoryArchiveContentReuseV1 } from 'shared';
import { HistoryArchiveContentReuseMigration1785520000000 } from '../../../database/migrations/1785520000000-HistoryArchiveContentReuseMigration.js';
import { historyArchiveCompactContentFactsSql } from '../HistoryArchiveCompactContentFactsSql.js';
import { contentFactsForStorage } from '../HistoryArchiveCompactContentFacts.js';
import { compactTemplateCache } from '../HistoryArchiveCompactTemplateCache.js';
import { resolveReusableCompletionsSql } from '../HistoryArchiveContentCompletionReferenceSql.js';
import {
	findReusableHistoryArchiveContent,
	prepareHistoryArchiveContentCompletions,
	recordHistoryArchiveContentEvidence,
	type PreparedContentCompletion
} from '../HistoryArchiveContentReuseWrite.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

jest.setTimeout(60_000);
const digest = 'a'.repeat(64);
const sourceId = randomUUID();
const sourceUrl = 'https://source.example/ledger-0000003f.xdr.gz';
const objectKey = 'ledger:0000003f';

describe('compact completion templates retain database authority', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let reuse: HistoryArchiveContentReuseV1;
	const oldFlag = process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED;
	beforeAll(async () => {
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'true';
		postgres = await startDisposablePostgres();
		db = new DataSource({ type: 'postgres', url: postgres.url });
		await db.initialize();
		await db.query(`create table history_archive_object_queue (
			"remoteId" uuid primary key, "objectType" text not null, "objectKey" text not null,
			"checkpointLedger" integer, status text not null, attempts integer not null,
			"verificationFacts" jsonb, "objectUrl" text not null);
			create table history_archive_object_ready (
			"objectRemoteId" uuid primary key references history_archive_object_queue("remoteId"),
			"dispatchToken" uuid, "claimAttempt" integer, "publishedAt" timestamptz);`);
		const runner = db.createQueryRunner();
		await runner.connect();
		await new HistoryArchiveContentReuseMigration1785520000000().up(runner);
		await runner.release();
		await db.query(historyArchiveCompactContentFactsSql);
		await db.query(
			`insert into history_archive_object_queue values ($1,'ledger',$2,63,'verified',1,$3,$4)`,
			[sourceId, objectKey, facts(sourceUrl), sourceUrl]
		);
		await recordHistoryArchiveContentEvidence(db.manager, sourceId, {
			progress: { claimAttempt: 1, verificationFacts: facts(sourceUrl) },
			reuse: null
		});
		const [artifact] = await db.query(
			`select id from history_archive_content_artifact`
		);
		reuse = {
			artifactId: artifact.id,
			sourceObjectRemoteId: sourceId,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1
		};
	});
	afterAll(async () => {
		if (oldFlag === undefined)
			delete process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED;
		else process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = oldFlag;
		if (db?.isInitialized) await db.destroy();
		if (postgres !== undefined) await postgres.stop();
	});
	beforeEach(() => compactTemplateCache(db.manager).delete(reuse.artifactId));

	async function target(url = 'https://target.example/ledger-0000003f.xdr.gz') {
		const remoteId = randomUUID();
		const executionId = randomUUID();
		await db.query(
			`insert into history_archive_object_queue values ($1,'ledger',$2,63,'pending',0,null,$3)`,
			[remoteId, objectKey, url]
		);
		await db.query(
			`insert into history_archive_object_ready values ($1,$2,1,now())`,
			[remoteId, executionId]
		);
		return {
			remoteId,
			progress: {
				claimAttempt: 1,
				executionId,
				scheduler: 'broker',
				contentReuse: reuse
			} satisfies HistoryArchiveObjectProgressUpdate
		};
	}
	async function warm() {
		const item = await target();
		const [miss] = await prepareHistoryArchiveContentCompletions(db.manager, [
			item
		]);
		expect(miss!.prepared.storageFacts).toBeUndefined();
		expect(
			miss!.prepared.progress.verificationFacts?.ledgerCategory?.ledgers
		).toHaveLength(64);
		return item;
	}
	async function accept(remoteId: string, prepared: PreparedContentCompletion) {
		await db.transaction(async (manager) => {
			await manager.query(
				`update history_archive_object_queue set status='verified',attempts=1,"verificationFacts"=$2 where "remoteId"=$1`,
				[remoteId, contentFactsForStorage(prepared)]
			);
			await recordHistoryArchiveContentEvidence(manager, remoteId, prepared);
		});
	}
	it('miss reads full facts; hit returns no artifact facts and stores exactly the legacy compact result', async () => {
		await warm();
		const item = await target('https://another.example/é-ledger.xdr.gz');
		const [raw] = await db.query(resolveReusableCompletionsSql, [
			JSON.stringify([
				{
					...item.progress,
					...reuse,
					remoteId: item.remoteId,
					omitVerificationFacts: true
				}
			])
		]);
		expect(raw).toMatchObject({
			activeClaim: true,
			artifactId: reuse.artifactId,
			verificationFacts: null
		});
		const [hit] = await prepareHistoryArchiveContentCompletions(db.manager, [
			item
		]);
		expect(hit!.prepared.progress.verificationFacts).toBeUndefined();
		expect(hit!.prepared.storageFacts).toEqual(
			contentFactsForStorage(
				{
					progress: {
						...item.progress,
						verificationFacts: facts('https://another.example/é-ledger.xdr.gz')
					},
					reuse
				},
				true
			)
		);
		await accept(item.remoteId, hit!.prepared);
		const [row] = await db.query(
			`select "verificationFacts" from history_archive_object_queue where "remoteId"=$1`,
			[item.remoteId]
		);
		expect(row.verificationFacts).toEqual(hit!.prepared.storageFacts);
	});
	it('seeds a template from facts already read by the content lookup endpoint', async () => {
		const item = await target();
		const found = await findReusableHistoryArchiveContent(db.manager, {
			remoteId: item.remoteId,
			executionId: item.progress.executionId,
			claimAttempt: 1,
			objectType: 'ledger',
			objectKey,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1
		});
		expect(found?.artifactId).toBe(reuse.artifactId);
		const [prepared] = await prepareHistoryArchiveContentCompletions(
			db.manager,
			[item]
		);
		expect(prepared!.prepared.progress.verificationFacts).toBeUndefined();
		expect(
			Buffer.byteLength(JSON.stringify(prepared!.prepared.storageFacts))
		).toBeLessThan(
			Buffer.byteLength(JSON.stringify(found!.verificationFacts)) / 10
		);
	});
	it('rejects a genuinely cached identity when the artifact is not present in this database', async () => {
		const item = await target();
		const missing = { ...reuse, artifactId: randomUUID() };
		compactTemplateCache(db.manager).put({
			reuse: missing,
			progress: { claimAttempt: 1, verificationFacts: facts(sourceUrl) }
		});
		expect(compactTemplateCache(db.manager).get(missing, 1)).toBeDefined();
		await expect(
			prepareHistoryArchiveContentCompletions(db.manager, [
				{ ...item, progress: { ...item.progress, contentReuse: missing } }
			])
		).rejects.toThrow(/artifact does not match/);
		expect(compactTemplateCache(db.manager).get(missing, 1)).toBeUndefined();
	});
	it.each(['token', 'attempt', 'unpublished', 'deleted'] as const)(
		'cached facts do not authorize a %s claim',
		async (kind) => {
			await warm();
			const item = await target();
			if (kind === 'token') item.progress.executionId = randomUUID();
			if (kind === 'attempt') item.progress.claimAttempt = 2;
			if (kind === 'unpublished')
				await db.query(
					`update history_archive_object_ready set "publishedAt"=null where "objectRemoteId"=$1`,
					[item.remoteId]
				);
			if (kind === 'deleted')
				await db.query(
					`delete from history_archive_object_ready where "objectRemoteId"=$1`,
					[item.remoteId]
				);
			expect(
				await prepareHistoryArchiveContentCompletions(db.manager, [item])
			).toEqual([]);
		}
	);
	it.each([
		'source',
		'digest',
		'version',
		'artifact',
		'checkpoint',
		'category',
		'objectKey'
	] as const)('rejects cached %s substitution', async (kind) => {
		await warm();
		const item = await target();
		const bad = { ...reuse };
		if (kind === 'source') bad.sourceObjectRemoteId = randomUUID();
		if (kind === 'digest') bad.contentDigest = 'b'.repeat(64);
		if (kind === 'artifact') bad.artifactId = randomUUID();
		// A wire-invalid future version still must not pass the database boundary.
		if (kind === 'version') Object.assign(bad, { derivationVersion: 2 });
		if (kind === 'checkpoint')
			await db.query(
				`update history_archive_object_queue set "checkpointLedger"=127 where "remoteId"=$1`,
				[item.remoteId]
			);
		if (kind === 'category')
			await db.query(
				`update history_archive_object_queue set "objectType"='transactions' where "remoteId"=$1`,
				[item.remoteId]
			);
		if (kind === 'objectKey')
			await db.query(
				`update history_archive_object_queue set "objectKey"='ledger:0000007f' where "remoteId"=$1`,
				[item.remoteId]
			);
		await expect(
			prepareHistoryArchiveContentCompletions(db.manager, [
				{ ...item, progress: { ...item.progress, contentReuse: bad } }
			])
		).rejects.toThrow(/artifact does not match/);
	});
	it('never treats a cached template as proof when its source observation is absent', async () => {
		await warm();
		const item = await target();
		await db
			.transaction(async (manager) => {
				await manager.query(
					`alter table history_archive_content_observation disable trigger "TR_history_archive_content_observation_immutable"`
				);
				await manager.query(
					`delete from history_archive_content_observation where "objectRemoteId"=$1`,
					[sourceId]
				);
				await expect(
					prepareHistoryArchiveContentCompletions(manager, [item])
				).rejects.toThrow(/artifact does not match/);
				throw new Error('restore fixture');
			})
			.catch((error: unknown) =>
				expect(error).toEqual(new Error('restore fixture'))
			);
	});
	it('keeps the unchanged validator fail-closed for forged summaries and rolls back the whole batch', async () => {
		await warm();
		const first = await target();
		const second = await target();
		const prepared = await prepareHistoryArchiveContentCompletions(db.manager, [
			first,
			second
		]);
		await expect(
			db.transaction(async (manager) => {
				for (const [index, item] of prepared.entries()) {
					const stored = contentFactsForStorage(item.prepared);
					if (index === 1 && stored != null)
						Object.assign(stored, {
							ledgerCategory: {
								entryCount: 0,
								headerHashesVerified: true,
								sourceUrl: 'https://forged.example'
							}
						});
					await manager.query(
						`update history_archive_object_queue set status='verified',attempts=1,"verificationFacts"=$2 where "remoteId"=$1`,
						[item.remoteId, stored]
					);
					await recordHistoryArchiveContentEvidence(
						manager,
						item.remoteId,
						item.prepared
					);
				}
			})
		).rejects.toThrow(/does not match its artifact/);
		expect(
			await db.query(
				`select status,attempts from history_archive_object_queue where "remoteId"=any($1::uuid[])`,
				[[first.remoteId, second.remoteId]]
			)
		).toEqual([
			{ status: 'pending', attempts: 0 },
			{ status: 'pending', attempts: 0 }
		]);
		// Caller mutation of one returned template did not poison its cached copy.
		const [again] = await prepareHistoryArchiveContentCompletions(db.manager, [
			first
		]);
		expect(again!.prepared.storageFacts?.ledgerCategory).toMatchObject({
			entryCount: 64
		});
	});
	it('disabled compact storage retains the original full-facts path even when warm', async () => {
		await warm();
		const item = await target();
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'false';
		try {
			const [row] = await prepareHistoryArchiveContentCompletions(db.manager, [
				item
			]);
			expect(row!.prepared.storageFacts).toBeUndefined();
			expect(
				row!.prepared.progress.verificationFacts?.ledgerCategory?.ledgers
			).toHaveLength(64);
		} finally {
			process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'true';
		}
	});
});

function facts(sourceUrlValue: string) {
	return {
		content: {
			algorithm: 'sha256',
			digest,
			representation: 'uncompressed-xdr'
		},
		ledgerCategory: {
			entryCount: 64,
			headerHashesVerified: true,
			sourceUrl: sourceUrlValue,
			ledgers: Array.from({ length: 64 }, (_, ledger) => ({
				ledger,
				bucketListHash: 'b'.repeat(64),
				ledgerHeaderHash: 'c'.repeat(64),
				previousLedgerHeaderHash: 'd'.repeat(64),
				protocolVersion: 29,
				transactionResultSetHash: 'e'.repeat(64),
				transactionSetHash: 'f'.repeat(64)
			}))
		}
	};
}
