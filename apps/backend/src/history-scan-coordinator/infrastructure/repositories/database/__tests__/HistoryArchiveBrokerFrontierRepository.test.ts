import type { DataSource, EntityManager } from 'typeorm';
import {
	HistoryArchiveBrokerFrontierRepository,
	reserveBrokerJobsSql
} from '../HistoryArchiveBrokerFrontierRepository.js';
import { materializeOrderedCheckpointPrefetch } from '../HistoryArchiveCheckpointPrefetch.js';
import { historyArchiveExecutionReconciliationLockName } from '../HistoryArchiveObjectExecutionReconciler.js';

describe('HistoryArchiveBrokerFrontierRepository', () => {
	it('admits independent ready objects without deleting a competing priority lane', () => {
		expect(reserveBrokerJobsSql).toContain('from eligible candidate');
		expect(reserveBrokerJobsSql).toContain(
			'ranked.active_count + ranked.host_rank <= $2::integer'
		);
		expect(reserveBrokerJobsSql).not.toContain('frozen_lane');
		expect(reserveBrokerJobsSql).toContain(
			'ranked."checkpointLedger" asc nulls first'
		);
		expect(reserveBrokerJobsSql).toContain('ranked."objectOrder"');
		expect(reserveBrokerJobsSql).not.toContain('deduplicated as materialized');
		expect(reserveBrokerJobsSql).not.toContain('displaced as');
		expect(reserveBrokerJobsSql).not.toContain('displacement_fence');
	});

	it('skips ready rows already locked by a terminal completion', () => {
		expect(reserveBrokerJobsSql).toContain('lockable as materialized');
		expect(reserveBrokerJobsSql).toContain('for update of ready skip locked');
		expect(reserveBrokerJobsSql).toContain(
			'and ready."objectRemoteId" = lockable."objectRemoteId"'
		);
	});

	it('marks broker reservations published inside the reservation transaction', () => {
		expect(reserveBrokerJobsSql).toContain('"publishedAt" = now()');
		expect(reserveBrokerJobsSql).toContain('"updatedAt" = now()');
	});

	it('allows an explicit retry token to bypass canonical-root selection', () => {
		const sql = reserveBrokerJobsSql.replace(/\s+/g, ' ');
		expect(sql).toContain('ready."dispatchToken" is not null or (');
		expect(sql).toContain('$4::text is null');
		expect(sql).toContain('not (select incomplete from canonical_scope)');
		expect(sql).toContain('ready."archiveUrlIdentity" = $4::text');
	});

	it('limits background replay to stale published reservations', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			query
		} as unknown as DataSource);
		const publishedBefore = new Date('2026-08-30T13:00:00.000Z');

		await repository.findPublishedJobs(
			24,
			2,
			'https://history.example',
			publishedBefore
		);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain(
			'ready."publishedAt" <= $3::timestamptz'
		);
		expect(query.mock.calls[0]?.[1]).toEqual([24, 2, publishedBefore]);
	});

	it('requeues old database reservations when the broker is empty', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce([{ count: 1 }])
			.mockResolvedValueOnce(undefined);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<number>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		const publishedBefore = new Date('2026-09-02T01:00:00.000Z');

		await expect(
			repository.requeueOrphanedPublishedJobs(publishedBefore, 240)
		).resolves.toBe(1);

		const sql = query.mock.calls[1]?.[0] as string;
		expect(sql).toContain("object.status in ('pending', 'failed')");
		expect(sql).toContain('"dispatchToken" = null');
		expect(sql).toContain('"claimAttempt" = null');
		expect(query.mock.calls[1]?.[1]).toEqual([publishedBefore, 240]);
		expect(query.mock.calls[2]?.[0]).toContain('pg_notify');
	});

	it('resets failed publishes in checkpoint fan-out lock order', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<void>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);

		await repository.resetPublished(['00000000-0000-0000-0000-000000000001']);
		const sql = query.mock.calls[0]?.[0] as string;
		expect(sql).toContain('failed_publish as materialized');
		expect(sql.replace(/\s+/g, ' ')).toContain(
			'order by ready."archiveUrlIdentity", ready."objectRemoteId"'
		);
		expect(sql).toContain('for update of ready');
		expect(sql).toContain('set "publishedAt" = null');
	});

	it('skips frontier reconciliation instead of queueing an exclusive lock', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<number>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);

		await expect(repository.ensureFrontier()).resolves.toBe(0);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('pg_try_advisory_xact_lock'),
			[historyArchiveExecutionReconciliationLockName]
		);
	});

	it('advances and enqueues a targeted proof frontier during recovery', async () => {
		const root = 'https://canonical.example';
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ planned: 1, ready: 0, advanced: 1 }])
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce([{ count: 1 }]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<void>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);

		await repository.ensureProofFrontier(root);

		expect(query).toHaveBeenCalledTimes(3);
		expect(query.mock.calls[0]?.[1]?.[2]).toEqual([root]);
		expect(query.mock.calls[2]?.[1]).toEqual([[root], 1]);
	});

	it('re-admits existing pending checkpoints inside the bounded prefetch window', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ planned: 2, ready: 0 }])
			.mockResolvedValueOnce([{ activated: 4, ready: 0 }]);
		const manager = { query } as unknown as EntityManager;

		const planned = await materializeOrderedCheckpointPrefetch(
			manager,
			'http://history.stellar.org/prd/core-live/core_live_001'
		);

		const sql = (query.mock.calls[0]?.[0] as string).replace(/\s+/g, ' ');
		expect(sql).toContain(
			'on conflict ("archiveUrlIdentity", "objectType", "objectKey") do nothing'
		);
		const activationSql = (query.mock.calls[1]?.[0] as string).replace(
			/\s+/g,
			' '
		);
		expect(activationSql).toContain(
			'cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(activationSql).toContain(
			'join "history_archive_checkpoint_bucket_dependency" dependency'
		);
		expect(activationSql).toContain("checkpoint_state.status = 'verified'");
		expect(activationSql).toContain('"dependencyReady" = true');
		expect(activationSql).toContain("'ordered-current-checkpoint'");
		expect(query.mock.calls[0]?.[1]).toEqual([
			expect.any(Number),
			'http://history.stellar.org/prd/core-live/core_live_001'
		]);
		expect(query.mock.calls[1]?.[1]).toEqual([
			'http://history.stellar.org/prd/core-live/core_live_001',
			expect.any(Number),
			expect.any(Number)
		]);
		expect(planned).toBe(6);
	});
});
