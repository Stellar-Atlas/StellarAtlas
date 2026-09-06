import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000 } from '../../../database/migrations/1785510000000-HistoryArchiveCheckpointProofRefreshQueueMigration.js';
import { materializeCanonicalFrontierDependenciesSql } from '../HistoryArchiveCanonicalFrontierSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from '../HistoryArchiveCheckpointDependencyReadSql.js';
import { enqueueProofRefreshesSql } from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import { writeHistoryArchiveSharedCheckpointContentShadow } from '../HistoryArchiveSharedCheckpointContentShadow.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createCanonicalCheckpointFacts,
	createCanonicalObject as object
} from './HistoryArchiveObjectExecutionTestFixtures.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const networkPassphrase = 'Shared dependency cutover test network';
const checkpointLedger = 127;
const bucketHash = 'ab'.repeat(32);
jest.setTimeout(60_000);

describe('shared checkpoint dependency cutover', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
		const queryRunner = dataSource.createQueryRunner();
		try {
			await new HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000().up(
				queryRunner
			);
		} finally {
			await queryRunner.release();
		}
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(`
			truncate history_archive_checkpoint_bucket_set,
				history_archive_checkpoint_content_conflict,
				history_archive_object_queue, history_archive_checkpoint_proof,
				history_archive_checkpoint_bucket_dependency,
				history_archive_checkpoint_scan_cursor,
				history_archive_checkpoint_proof_refresh_queue,
				history_archive_state_snapshot, full_history_promotion_runtime
			restart identity cascade
		`);
	});

	it('avoids root-by-bucket legacy writes while preserving separate source observations and objects', async () => {
		const checkpoints = await seedSources();
		await writeShared(checkpoints);

		const [result] = await dataSource.query(
			materializeCanonicalFrontierDependenciesSql
		);
		expect(result.inserted).toBe(0);
		expect(await count('history_archive_checkpoint_bucket_dependency')).toBe(0);
		expect(await count('history_archive_checkpoint_bucket_set_member')).toBe(1);
		expect(await count('history_archive_checkpoint_content_observation')).toBe(
			2
		);
		expect(
			await dataSource.getRepository(HistoryArchiveObject).countBy({
				objectType: 'bucket',
				bucketHash
			})
		).toBe(2);
		for (const checkpoint of checkpoints) {
			expect(await dependencies(checkpoint)).toHaveLength(1);
		}

		const [replay] = await dataSource.query(
			materializeCanonicalFrontierDependenciesSql
		);
		expect(replay.inserted).toBe(0);
		expect(await count('history_archive_checkpoint_content_observation')).toBe(
			2
		);
	});

	it('keeps a disjoint indexed legacy fallback for a source without an observation', async () => {
		const [shared, legacy] = await seedSources();
		await writeShared([shared]);

		const [result] = await dataSource.query(
			materializeCanonicalFrontierDependenciesSql
		);
		expect(result.inserted).toBe(1);
		expect(
			await dataSource.query(`
			select "archiveUrlIdentity", "bucketHash"
			from history_archive_checkpoint_bucket_dependency
		`)
		).toEqual([
			{
				archiveUrlIdentity: legacy.archiveUrlIdentity,
				bucketHash
			}
		]);
		expect(await dependencies(shared)).toHaveLength(1);
		expect(await dependencies(legacy)).toHaveLength(1);

		// Existing duplicate rows remain evidence, but cannot duplicate reads.
		await dataSource.query(
			`
			insert into history_archive_checkpoint_bucket_dependency (
				"archiveUrlIdentity", "checkpointLedger", "bucketHash"
			) values ($1, $2, $3)
		`,
			[shared.archiveUrlIdentity, checkpointLedger, bucketHash]
		);
		expect(await dependencies(shared)).toHaveLength(1);
	});

	it.each([
		'wrong-source-object',
		'changed-content',
		'changed-bucket-list',
		'incomplete-members',
		'wrong-member'
	] as const)(
		'does not suppress legacy writes for %s shared evidence',
		async (fault) => {
			const [checkpoint] = await seedSources(1);
			await writeShared([checkpoint]);
			switch (fault) {
				case 'wrong-source-object':
					await dataSource.query(`
					update history_archive_checkpoint_content_observation
					set "checkpointStateObjectRemoteId" = gen_random_uuid()
				`);
					break;
				case 'changed-content':
					await dataSource.query(
						`
					update history_archive_object_queue
					set "verificationFacts" = jsonb_set(
						"verificationFacts", '{content,digest}', to_jsonb($1::text)
					) where "remoteId" = $2
				`,
						['fe'.repeat(32), checkpoint.remoteId]
					);
					break;
				case 'changed-bucket-list':
					await dataSource.query(
						`
					update history_archive_checkpoint_content
					set "bucketListHash" = $1
				`,
						['aa'.repeat(32)]
					);
					break;
				case 'incomplete-members':
					await dataSource.query(
						'delete from history_archive_checkpoint_bucket_set_member'
					);
					break;
				case 'wrong-member':
					await dataSource.query(
						`
					update history_archive_checkpoint_bucket_set_member
					set "bucketHash" = $1
				`,
						['aa'.repeat(32)]
					);
					break;
			}

			const [result] = await dataSource.query(
				materializeCanonicalFrontierDependenciesSql
			);
			expect(result.inserted).toBe(1);
			expect(await count('history_archive_checkpoint_bucket_dependency')).toBe(
				1
			);
			// Conflicting observations are retained, never silently overwritten.
			expect(
				await count('history_archive_checkpoint_content_observation')
			).toBe(1);
		}
	);

	it('enqueues shared-only bucket completion at the source frontier without rewriting dependency evidence', async () => {
		const [checkpoint, otherCheckpoint] = await seedSources();
		await writeShared([checkpoint, otherCheckpoint]);
		const completed = object(
			0,
			'bucket',
			'bucket:' + bucketHash,
			null,
			'verified'
		);
		completed.bucketHash = bucketHash;
		completed.verifiedAt = new Date('2026-01-02T00:00:00Z');
		const failed = object(1, 'bucket', 'bucket:' + bucketHash, null, 'failed');
		failed.bucketHash = bucketHash;
		failed.errorType = 'archive_http_error';
		failed.httpStatus = 404;
		failed.errorMessage = 'Source returned HTTP 404';
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([completed, failed]);
		const categories = (['ledger', 'transactions', 'results'] as const).map(
			(type) =>
				object(0, type, type + ':0000007f', checkpointLedger, 'verified')
		);
		await dataSource.getRepository(HistoryArchiveObject).save(categories);
		for (const source of [checkpoint, otherCheckpoint]) {
			const predecessor = createBucketMissingProof(
				source.archiveUrlIdentity,
				63
			);
			predecessor.status = 'verified';
			await dataSource
				.getRepository(HistoryArchiveCheckpointProof)
				.save(predecessor);
			await dataSource.query(
				`
				insert into history_archive_checkpoint_scan_cursor (
					"archiveUrlIdentity", "latestCheckpointLedger",
					"nextHistoricalCheckpointLedger"
				) values ($1, $2, $2 + 64)
			`,
				[source.archiveUrlIdentity, checkpointLedger]
			);
		}
		const before = await dependencies(checkpoint);

		const [result] = await dataSource.query(enqueueProofRefreshesSql, [
			[completed.remoteId]
		]);
		expect(result.count).toBe(1);
		expect(
			await dataSource.query(`
			select "archiveUrlIdentity", "checkpointLedger", generation
			from history_archive_checkpoint_proof_refresh_queue
		`)
		).toEqual([
			{
				archiveUrlIdentity: checkpoint.archiveUrlIdentity,
				checkpointLedger,
				generation: '1'
			}
		]);
		await dataSource.query(`
			update history_archive_checkpoint_proof_refresh_queue
			set "leaseToken" = gen_random_uuid(), "leaseUntil" = now() + interval '1 minute',
				attempts = 3, "lastError" = 'retry evidence'
		`);
		const queued = await dataSource.query(
			'select * from history_archive_checkpoint_proof_refresh_queue'
		);

		const [replay] = await dataSource.query(enqueueProofRefreshesSql, [
			[completed.remoteId]
		]);
		expect(replay.count).toBe(0);
		expect(
			await dataSource.query(
				'select * from history_archive_checkpoint_proof_refresh_queue'
			)
		).toEqual(queued);
		expect(await dependencies(checkpoint)).toEqual(before);
		expect(await count('history_archive_checkpoint_bucket_dependency')).toBe(0);
		const retained = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({
				remoteId: failed.remoteId
			});
		expect(retained.status).toBe('failed');
		expect(retained.errorMessage).toBe('Source returned HTTP 404');
	});

	async function seedSources(sourceCount = 2): Promise<HistoryArchiveObject[]> {
		const checkpoints: HistoryArchiveObject[] = [];
		for (let index = 0; index < sourceCount; index++) {
			const root = object(
				index,
				'history-archive-state',
				'root',
				null,
				'verified',
				0
			);
			const checkpoint = object(
				index,
				'checkpoint-state',
				'checkpoint-state:0000007f',
				checkpointLedger,
				'verified'
			);
			checkpoint.verificationFacts = createCanonicalCheckpointFacts(
				bucketHash,
				checkpoint.objectUrl,
				checkpointLedger
			);
			checkpoint.verifiedAt = new Date('2026-01-01T00:00:00Z');
			checkpoint.dependenciesMaterializedAt = checkpoint.verifiedAt;
			await dataSource
				.getRepository(HistoryArchiveObject)
				.save([root, checkpoint]);
			await dataSource.query(
				`
				insert into history_archive_state_snapshot (
					"archiveUrlIdentity", status, "networkPassphrase"
				) values ($1, 'available', $2)
			`,
				[root.archiveUrlIdentity, networkPassphrase]
			);
			checkpoints.push(checkpoint);
		}
		await dataSource.query(
			`
			insert into full_history_promotion_runtime (
				network_passphrase_hash, state, checkpoint_ledger
			) values ($1, 'waiting-for-proof', $2)
		`,
			[
				createHash('sha256').update(networkPassphrase).digest(),
				checkpointLedger
			]
		);
		return checkpoints;
	}

	async function writeShared(
		checkpoints: readonly HistoryArchiveObject[]
	): Promise<void> {
		await writeHistoryArchiveSharedCheckpointContentShadow(
			dataSource.getRepository(HistoryArchiveObject),
			checkpoints.map((checkpoint) => checkpoint.remoteId)
		);
	}

	async function dependencies(
		checkpoint: HistoryArchiveObject
	): Promise<unknown[]> {
		return dataSource.query(
			historyArchiveCheckpointBucketDependenciesSql('$1', '$2'),
			[checkpoint.archiveUrlIdentity, checkpoint.checkpointLedger]
		);
	}

	async function count(table: string): Promise<number> {
		const [row] = await dataSource.query(
			`select count(*)::integer as count from "${table}"`
		);
		return row.count as number;
	}
});
