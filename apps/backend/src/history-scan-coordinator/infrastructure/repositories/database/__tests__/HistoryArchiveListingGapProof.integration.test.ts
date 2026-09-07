import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { publicNetworkPassphrase } from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';
import { createBucketMissingProof } from './HistoryArchiveObjectExecutionTestFixtures.js';
import {
	createProofDataSource,
	saveProofFixture,
	refreshAndLoadProof,
	proofArchiveUrl,
	proofCheckpointLedger
} from './HistoryArchiveCheckpointProofFixture.js';
import type { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';

jest.setTimeout(90_000);
describe('listing gap boundary still verifies actual ledger linkage', () => {
	let pg: DisposablePostgres,
		db: DataSource,
		repository: TypeOrmHistoryArchiveCheckpointProofRepository;
	const sourceUrl = 'https://independent-source.example/archive';
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		({ dataSource: db, repository } = await createProofDataSource(pg.url));
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_checkpoint_proof,history_archive_object_queue,history_archive_checkpoint_bucket_dependency cascade'
		);
		await saveProofFixture(db);
		const prev = await db
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({
				archiveUrlIdentity: proofArchiveUrl,
				checkpointLedger: proofCheckpointLedger - 64,
				objectType: 'ledger'
			});
		prev.archiveUrl = sourceUrl;
		prev.archiveUrlIdentity = sourceUrl;
		prev.objectUrl = prev.objectUrl.replace(proofArchiveUrl, sourceUrl);
		if (!prev.verificationFacts?.ledgerCategory)
			throw new Error('Missing predecessor fixture');
		prev.verificationFacts = {
			...prev.verificationFacts,
			ledgerCategory: {
				...prev.verificationFacts.ledgerCategory,
				sourceUrl: prev.objectUrl
			}
		};
		await db.getRepository(HistoryArchiveObject).save(prev);
		const anchor = createBucketMissingProof(
			sourceUrl,
			proofCheckpointLedger - 64
		);
		anchor.status = 'verified';
		anchor.failureKind = null;
		anchor.bucketsVerified = true;
		anchor.ledgerObjectRemoteId = prev.remoteId;
		await db.getRepository(HistoryArchiveCheckpointProof).save(anchor);
		await db.query(
			'insert into history_archive_state_snapshot ("archiveUrlIdentity",status,"networkPassphrase","currentLedger") values ($1,\'available\',$3,$4),($2,\'available\',$3,$4) on conflict ("archiveUrlIdentity") do update set "networkPassphrase"=excluded."networkPassphrase",status=excluded.status',
			[
				proofArchiveUrl,
				sourceUrl,
				publicNetworkPassphrase,
				proofCheckpointLedger
			]
		);
		await db.query(
			'insert into history_archive_listing_gap ("archiveUrlIdentity","firstCheckpointLedger","lastCheckpointLedger","resumeCheckpointLedger","observedAt","listingEvidence","sourceCheckpointProofId") values ($1,63,$2,$3,now(),\'{}\',$4)',
			[
				proofArchiveUrl,
				proofCheckpointLedger - 64,
				proofCheckpointLedger,
				anchor.id
			]
		);
	});
	it('verifies the resumed checkpoint with explicit independent predecessor provenance', async () => {
		const proof = await refreshAndLoadProof(db, repository);
		expect(proof).toMatchObject({
			status: 'verified',
			previousLedgersMatch: true,
			proofFactsComplete: true
		});
		expect(proof?.details).toMatchObject({
			predecessorSubstituted: true,
			predecessorSourceArchiveUrlIdentity: sourceUrl
		});
		expect(
			await db.query(
				'select count(*)::integer count from history_archive_checkpoint_substitution'
			)
		).toEqual([{ count: 0 }]);
	});
	it('rejects a wrong predecessor hash even though the listing and source anchor exist', async () => {
		await db.query(
			'update history_archive_object_queue set "verificationFacts"=jsonb_set("verificationFacts",\'{ledgerCategory,ledgers,0,ledgerHeaderHash}\',\'"wrong-hash"\') where "archiveUrlIdentity"=$1 and "objectType"=\'ledger\'',
			[sourceUrl]
		);
		const proof = await refreshAndLoadProof(db, repository);
		expect(proof?.status).not.toBe('verified');
		expect(proof?.previousLedgersMatch).toBe(false);
	});
});
