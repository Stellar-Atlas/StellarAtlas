import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000 } from '../../../database/migrations/1785510000000-HistoryArchiveCheckpointProofRefreshQueueMigration.js';
import { enqueueProofRefreshesSql } from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createCanonicalObject
} from './HistoryArchiveObjectExecutionTestFixtures.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const firstEvidence = '2026-01-02T00:00:00.000Z';
const newerEvidence = '2026-01-03T00:00:00.000Z';
interface QueuedRefreshRow {
	readonly evidenceUpdatedAt: Date;
	readonly generation: string;
	readonly attempts: number;
	readonly leaseToken: string | null;
	readonly leaseUntil: Date | null;
	readonly lastError: string | null;
	readonly row_version: string;
}
jest.setTimeout(60_000);

describe('checkpoint proof enqueue covered notifications', () => {
	let postgres: DisposablePostgres;
	let dataSource: DataSource;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			type: 'postgres',
			url: postgres.url,
			synchronize: true,
			entities: [HistoryArchiveObject, HistoryArchiveCheckpointProof]
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
		const runner = dataSource.createQueryRunner();
		try {
			await new HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(`truncate history_archive_object_queue,
			history_archive_checkpoint_proof, history_archive_checkpoint_scan_cursor,
			history_archive_checkpoint_proof_refresh_queue restart identity cascade`);
	});

	it('filters covered targets before readiness without materializing unused object facts', () => {
		const source = enqueueProofRefreshesSql.split(
			'), affected as materialized'
		)[0];
		expect(source).not.toContain('object.*');
		expect(source).not.toContain('"verificationFacts"');
		expect(enqueueProofRefreshesSql).toContain(
			'pending_targets as materialized'
		);
		expect(enqueueProofRefreshesSql).toContain(
			'queued."evidenceUpdatedAt" >= candidate.evidence_updated_at'
		);
		expect(enqueueProofRefreshesSql).toContain(
			'where excluded."evidenceUpdatedAt" >'
		);
	});

	it('preserves equal/older leases and physical rows while superseding only newer evidence in one batch', async () => {
		const objects = await seed(3);
		await enqueue(objects);
		await dataSource.query(`update history_archive_checkpoint_proof_refresh_queue
			set "leaseToken" = gen_random_uuid(), "leaseUntil" = now() + interval '1 minute',
				attempts = 3, "lastError" = 'retained retry'`);
		const before = await queuedRows();
		await setEvidence(objects[1], '2026-01-01T00:00:00.000Z');
		await setEvidence(objects[2], newerEvidence);
		expect(await enqueue(objects)).toBe(1);
		const after = await queuedRows();
		expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
		expect(after[2]).toMatchObject({
			generation: '2',
			attempts: 0,
			leaseToken: null,
			leaseUntil: null,
			lastError: null
		});
		expect(after[2].evidenceUpdatedAt.toISOString()).toBe(newerEvidence);
		expect(
			await dataSource
				.getRepository(HistoryArchiveObject)
				.countBy({ status: 'failed' })
		).toBe(3);
	});

	it('does not reinsert covered evidence when a consumer concurrently commits its proof and retires the row', async () => {
		const [object] = await seed(1);
		await enqueue([object]);
		const consumer = dataSource.createQueryRunner();
		await consumer.startTransaction();
		try {
			const proof = createBucketMissingProof(object.archiveUrlIdentity, 63);
			proof.failureKind = 'object-failed';
			proof.evaluatedAt = new Date(firstEvidence);
			await consumer.manager
				.getRepository(HistoryArchiveCheckpointProof)
				.save(proof);
			await consumer.query(
				'delete from history_archive_checkpoint_proof_refresh_queue'
			);
			expect(await enqueue([object])).toBe(0);
			await consumer.commitTransaction();
			expect(await queuedRows()).toEqual([]);
			expect(
				await dataSource.getRepository(HistoryArchiveCheckpointProof).count()
			).toBe(1);
		} finally {
			if (consumer.isTransactionActive) await consumer.rollbackTransaction();
			await consumer.release();
		}
	});

	it('keeps genuinely newer evidence when an older consumer retires its row during enqueue', async () => {
		const [object] = await seed(1);
		await enqueue([object]);
		await setEvidence(object, newerEvidence);
		const consumer = dataSource.createQueryRunner();
		const producer = dataSource.createQueryRunner();
		await consumer.startTransaction();
		await producer.connect();
		await producer.query("set statement_timeout = '5s'");
		try {
			await consumer.query(
				'delete from history_archive_checkpoint_proof_refresh_queue'
			);
			const [identity] = await producer.query('select pg_backend_pid() as pid');
			const pending = producer.query(enqueueProofRefreshesSql, [
				[object.remoteId]
			]);
			try {
				// Wait for this disposable producer's unique-key conflict, not a sleep
				// that could let the consumer commit before its statement snapshot.
				let waiting = false;
				for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
					const [activity] = await dataSource.query(
						'select wait_event_type from pg_stat_activity where pid = $1',
						[identity.pid]
					);
					waiting = activity?.wait_event_type === 'Lock';
					if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
				}
				expect(waiting).toBe(true);
				await consumer.commitTransaction();
				expect((await pending)[0].count).toBe(1);
			} finally {
				if (consumer.isTransactionActive) await consumer.rollbackTransaction();
				await pending;
			}
			const rows = await queuedRows();
			expect(rows).toHaveLength(1);
			expect(rows[0].evidenceUpdatedAt.toISOString()).toBe(newerEvidence);
		} finally {
			if (consumer.isTransactionActive) await consumer.rollbackTransaction();
			await producer.query('reset statement_timeout');
			await producer.release();
			await consumer.release();
		}
	});

	async function seed(count: number): Promise<HistoryArchiveObject[]> {
		const objects = Array.from({ length: count }, (_, index) =>
			createCanonicalObject(
				index,
				'checkpoint-state',
				'checkpoint-state:0000003f',
				63,
				'failed'
			)
		);
		await dataSource.getRepository(HistoryArchiveObject).save(objects);
		for (const object of objects) {
			await setEvidence(object, firstEvidence);
			await dataSource.query(
				`insert into history_archive_checkpoint_scan_cursor
				("archiveUrlIdentity", "latestCheckpointLedger", "nextHistoricalCheckpointLedger")
				values ($1, 63, 127)`,
				[object.archiveUrlIdentity]
			);
		}
		return objects;
	}

	async function setEvidence(
		object: HistoryArchiveObject,
		timestamp: string
	): Promise<void> {
		await dataSource.query(
			'update history_archive_object_queue set "updatedAt" = $1 where "remoteId" = $2',
			[timestamp, object.remoteId]
		);
	}

	async function enqueue(
		objects: readonly HistoryArchiveObject[]
	): Promise<number> {
		const [result] = await dataSource.query(enqueueProofRefreshesSql, [
			objects.map((object) => object.remoteId)
		]);
		return result.count;
	}

	async function queuedRows(): Promise<readonly QueuedRefreshRow[]> {
		return await dataSource.query(
			'select *, xmin::text as row_version, xmax::text as row_lock from history_archive_checkpoint_proof_refresh_queue order by "archiveUrlIdentity"'
		);
	}
});
