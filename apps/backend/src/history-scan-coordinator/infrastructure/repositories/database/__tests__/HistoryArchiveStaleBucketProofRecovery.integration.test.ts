import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import {
	drainHistoryArchiveCheckpointProofRefreshes,
	enqueueTargetedTerminalReadyCheckpointProofRefreshes
} from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import {
	createProofDataSource,
	proofArchiveUrl as root,
	saveProofFixture
} from './HistoryArchiveCheckpointProofFixture.js';

jest.setTimeout(60_000);
describe('current open stale bucket proof recovery', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let repository: TypeOrmHistoryArchiveCheckpointProofRepository;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource: db, repository } = await createProofDataSource(
			postgres.url
		));
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(`truncate history_archive_checkpoint_content,
			history_archive_checkpoint_proof_refresh_queue,history_archive_checkpoint_proof,
			history_archive_object_queue,history_archive_checkpoint_bucket_dependency,
			history_archive_checkpoint_scan_cursor restart identity cascade`);
		await saveProofFixture(db, { checkpointLedger: 63 });
		await db.query(
			`update history_archive_object_queue set status='pending',"verifiedAt"=null
			where "archiveUrlIdentity"=$1 and "objectType"='bucket'`,
			[root]
		);
		await repository.refreshForArchiveCheckpoint({
			archiveUrlIdentity: root,
			checkpointLedger: 63
		});
		expect(await proof()).toMatchObject({
			status: 'not-evaluable',
			failureKind: 'bucket-missing'
		});
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor
			("archiveUrlIdentity","latestCheckpointLedger","lastForwardCheckpointLedger","nextHistoricalCheckpointLedger")
			values($1,127,63,127)`,
			[root]
		);
	});
	async function proof() {
		const [value] = await db.query(
			`select status,"failureKind","evaluatedAt","missingBucketCount" from history_archive_checkpoint_proof
			where "archiveUrlIdentity"=$1 and "checkpointLedger"=63`,
			[root]
		);
		return value;
	}
	async function completeBucket() {
		await db.query(
			`update history_archive_object_queue bucket set status='verified',
			"verifiedAt"=proof."evaluatedAt"+interval '1 microsecond'
			from history_archive_checkpoint_proof proof
			where bucket."archiveUrlIdentity"=$1 and bucket."objectType"='bucket'
			and proof."archiveUrlIdentity"=$1 and proof."checkpointLedger"=63`,
			[root]
		);
	}
	const enqueue = (roots = [root]) =>
		db.transaction((manager) =>
			enqueueTargetedTerminalReadyCheckpointProofRefreshes(manager, roots)
		);
	it('recovers a lost final-bucket wake through the normal proof engine, once', async () => {
		await completeBucket();
		expect(await enqueue()).toBe(1);
		expect(await enqueue()).toBe(0);
		expect(await proof()).toMatchObject({
			status: 'not-evaluable',
			failureKind: 'bucket-missing'
		});
		expect(
			await drainHistoryArchiveCheckpointProofRefreshes(db, 1, 1)
		).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
		expect(await proof()).toMatchObject({
			status: 'verified',
			failureKind: null,
			missingBucketCount: 0
		});
		expect(await enqueue()).toBe(0);
	});
	it('does not enqueue a bucket that has not completed', async () => {
		expect(await enqueue()).toBe(0);
	});
	it.each([
		['matched', 'false'],
		['expectedBucketHash', JSON.stringify('b'.repeat(64))],
		['sourceUrl', JSON.stringify('https://other.example/bucket')]
	])('rejects invalid bucket %s evidence', async (key, value) => {
		await completeBucket();
		await db.query(
			`update history_archive_object_queue
			set "verificationFacts"=jsonb_set("verificationFacts",array['bucketObject',$2::text],$3::jsonb)
			where "archiveUrlIdentity"=$1 and "objectType"='bucket'`,
			[root, key, value]
		);
		expect(await enqueue()).toBe(0);
	});
	it('rejects mismatching dependency counts', async () => {
		await completeBucket();
		await db.query(
			`update history_archive_checkpoint_proof set "expectedBucketCount"=2 where "archiveUrlIdentity"=$1`,
			[root]
		);
		expect(await enqueue()).toBe(0);
	});
	it('requires newer verified evidence and completed transition effects', async () => {
		await completeBucket();
		await db.query(
			`update history_archive_object_queue bucket set "verifiedAt"=proof."evaluatedAt"
			from history_archive_checkpoint_proof proof where bucket."archiveUrlIdentity"=$1
			and bucket."objectType"='bucket' and proof."archiveUrlIdentity"=$1`,
			[root]
		);
		expect(await enqueue()).toBe(0);
		await completeBucket();
		await db.query(
			`update history_archive_object_queue set "transitionEffectsRequiredAt"=now(),"transitionEffectsCompletedAt"=null
			where "archiveUrlIdentity"=$1 and "objectType"='bucket'`,
			[root]
		);
		expect(await enqueue()).toBe(0);
	});
	it('keeps exact root and current-frontier scope', async () => {
		await completeBucket();
		expect(await enqueue(['https://other.example/archive'])).toBe(0);
		await db.query(
			`update history_archive_checkpoint_scan_cursor set "nextHistoricalCheckpointLedger"=191 where "archiveUrlIdentity"=$1`,
			[root]
		);
		expect(await enqueue()).toBe(0);
	});
	it('does not borrow another root’s verified bucket with the same hash', async () => {
		await completeBucket();
		await db.query(
			`update history_archive_object_queue set "archiveUrlIdentity"='https://other.example/archive'
			where "archiveUrlIdentity"=$1 and "objectType"='bucket'`,
			[root]
		);
		expect(await enqueue()).toBe(0);
	});
});
