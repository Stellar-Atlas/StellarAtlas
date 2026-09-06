import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveSharedBucketSetShadowMigration1788494000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1788494000000-HistoryArchiveSharedBucketSetShadowMigration.js';
import { HistoryArchiveRemoteFailureContinuationMigration1788601000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1788601000000-HistoryArchiveRemoteFailureContinuationMigration.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	materializeCompactCheckpointPlans,
	materializeNextCompactCheckpointPlans
} from '../HistoryArchiveCompactPlanning.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucket,
	createBucketMissingProof,
	createCheckpoint,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('source failures permit attributed continuation, never false verification', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	const previousCanonical = process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			type: 'postgres',
			url: postgres.url,
			dropSchema: true,
			synchronize: true,
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			logging: false
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
		await dataSource.query(
			'alter table "history_archive_checkpoint_bucket_dependency" add column if not exists "createdAt" timestamptz not null default now()'
		);
		const runner = dataSource.createQueryRunner();
		try {
			await new HistoryArchiveSharedBucketSetShadowMigration1788494000000().up(
				runner
			);
			await new HistoryArchiveRemoteFailureContinuationMigration1788601000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
	});
	beforeEach(async () => {
		await dataSource.query(`truncate "history_archive_object_queue",
   "history_archive_checkpoint_proof", "history_archive_state_snapshot",
   "history_archive_checkpoint_scan_cursor", "history_archive_checkpoint_substitution",
   "history_archive_checkpoint_bucket_dependency" cascade`);
	});
	afterAll(async () => {
		if (previousCanonical === undefined)
			delete process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
		else process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = previousCanonical;
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	const scenarios = [
		{
			name: 'first checkpoint transport timeout',
			bucket: false,
			eligible: true
		},
		{
			name: 'first transport timeout on a bucket reused from an earlier checkpoint',
			bucket: true,
			eligible: true
		},
		{
			name: 'worker failure',
			bucket: false,
			channel: 'scanner_internal',
			eligible: false
		},
		{ name: 'pending object', bucket: false, pending: true, eligible: false },
		{
			name: 'different network source',
			bucket: false,
			network: 'different',
			eligible: false
		},
		{
			name: 'unverified source checkpoint',
			bucket: false,
			unverified: true,
			eligible: false
		}
	] as const;

	for (const path of ['completion', 'recovery'] as const) {
		it.each(scenarios)(path + ': $name', async (scenario) => {
			const target = createRoot(30);
			const source = createRoot(31);
			process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT =
				source.archiveUrlIdentity;
			await dataSource
				.getRepository(HistoryArchiveObject)
				.save([target, source]);
			await dataSource.query(
				`insert into "history_archive_state_snapshot"
    ("archiveUrlIdentity", status, "currentLedger", "networkPassphrase")
    values ($1, 'available', 1000, 'network'), ($2, 'available', 1000, $3)`,
				[
					target.archiveUrlIdentity,
					source.archiveUrlIdentity,
					'network' in scenario ? scenario.network : 'network'
				]
			);
			await dataSource.query(
				`insert into "history_archive_checkpoint_scan_cursor"
    ("archiveUrlIdentity", "latestCheckpointLedger", "lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger")
    values ($1, 959, null, 191)`,
				[target.archiveUrlIdentity]
			);

			const failed = createBucketMissingProof(target.archiveUrlIdentity, 127);
			failed.failureKind = 'object-failed';
			failed.requiredObjectsComplete = false;
			failed.details = {
				objectFailures: [
					{ httpStatus: null, errorType: 'archive_transport_error' }
				]
			};
			const anchor = createBucketMissingProof(source.archiveUrlIdentity, 127);
			anchor.status = 'unverified' in scenario ? 'not-evaluable' : 'verified';
			anchor.requiredObjectsComplete = true;
			anchor.proofFactsComplete = true;
			anchor.bucketsVerified = true;
			anchor.verifiedBucketCount = 1;
			anchor.missingBucketCount = 0;
			anchor.failureKind = null;
			await dataSource
				.getRepository(HistoryArchiveCheckpointProof)
				.save([failed, anchor]);

			const hash = 'ab'.repeat(32);
			const object = scenario.bucket
				? createBucket(30, hash)
				: createCheckpoint(30, 127);
			if (scenario.bucket) object.checkpointLedger = 63;
			object.status = 'pending' in scenario ? 'pending' : 'failed';
			object.attempts = 1;
			object.failureChannel =
				'channel' in scenario ? scenario.channel : 'archive_availability';
			object.errorType = 'archive_transport_error';
			object.errorMessage = 'ETIMEDOUT';
			await dataSource.getRepository(HistoryArchiveObject).save(object);
			if (scenario.bucket)
				await dataSource.query(
					`insert into "history_archive_checkpoint_bucket_dependency"
    ("archiveUrlIdentity", "checkpointLedger", "bucketHash") values ($1, 127, $2)`,
					[target.archiveUrlIdentity, hash]
				);

			const plan = async () =>
				path === 'completion'
					? materializeNextCompactCheckpointPlans(dataSource.manager, [
							{
								archiveUrlIdentity: target.archiveUrlIdentity,
								checkpointLedger: 127
							}
						])
					: materializeCompactCheckpointPlans(dataSource.manager, [
							target.archiveUrlIdentity
						]);
			await plan();
			await plan();

			const substitutions = await dataSource.query(
				`select "failedCheckpointProofId", "sourceCheckpointProofId", reason
    from "history_archive_checkpoint_substitution" where "archiveUrlIdentity" = $1`,
				[target.archiveUrlIdentity]
			);
			expect(substitutions).toEqual(
				scenario.eligible
					? [
							{
								failedCheckpointProofId: failed.id,
								sourceCheckpointProofId: anchor.id,
								reason: 'remote-source-failure'
							}
						]
					: []
			);
			const [cursor] = await dataSource.query(
				`select "nextHistoricalCheckpointLedger" from "history_archive_checkpoint_scan_cursor"
    where "archiveUrlIdentity" = $1`,
				[target.archiveUrlIdentity]
			);
			expect(cursor.nextHistoricalCheckpointLedger).toBe(
				scenario.eligible ? 255 : 191
			);
			expect(
				await dataSource
					.getRepository(HistoryArchiveCheckpointProof)
					.findOneByOrFail({ id: failed.id })
			).toMatchObject({
				status: 'not-evaluable',
				failureKind: 'object-failed',
				requiredObjectsComplete: false
			});
			expect(
				await dataSource
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: object.remoteId })
			).toMatchObject({
				status: object.status,
				attempts: 1,
				errorMessage: 'ETIMEDOUT'
			});
		});
	}
});
