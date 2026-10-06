import type { DataSource, EntityManager } from 'typeorm';
import {
	HistoryArchiveBrokerFrontierRepository,
	compareHistoryArchiveBrokerJobs
} from '../HistoryArchiveBrokerFrontierRepository.js';
import { HistoryArchiveRamCandidateFeed } from '../HistoryArchiveRamCandidateFeed.js';

const selected = [
	{
		remoteId: '00000000-0000-0000-0000-000000000001',
		selectedOrdinal: 1,
		firstPassRootReadyAt: '2026-10-06T00:00:00.000001Z'
	}
];
describe('RAM candidate repository integration', () => {
	const before = process.env.HISTORY_ARCHIVE_RETRY_PHASE;
	beforeEach(() => {
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'first-pass';
	});
	afterEach(() => {
		if (before === undefined) delete process.env.HISTORY_ARCHIVE_RETRY_PHASE;
		else process.env.HISTORY_ARCHIVE_RETRY_PHASE = before;
	});
	it('bounds locks before dispatcher mutex then claims only supplied IDs without hydration', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<unknown>) =>
				work({ query } as unknown as EntityManager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(
			repository.reserveCandidateIds(
				selected,
				8,
				2,
				'https://canonical.example'
			)
		).resolves.toEqual([]);
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(4);
		expect(query.mock.calls[0]?.[0]).toBe("set local lock_timeout = '250ms'");
		expect(query.mock.calls[1]?.[0]).toContain('pg_advisory_xact_lock');
		expect(query.mock.calls[2]?.[0]).toBe("set local work_mem = '32MB'");
		expect(query.mock.calls[3]?.[0]).toContain('ram_input as materialized');
		expect(query.mock.calls[3]?.[0]).not.toContain('fresh_root_minimum');
		expect(query.mock.calls[3]?.[1]).toEqual([
			1,
			8,
			2,
			'https://canonical.example',
			JSON.stringify(selected)
		]);
	});
	it('does no work for empty input or the recheck phase', async () => {
		const transaction = jest.fn();
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		expect(await repository.reserveCandidateIds([], 8)).toEqual([]);
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'recheck';
		expect(await repository.reserveCandidateIds(selected, 8)).toEqual([]);
		expect(transaction).not.toHaveBeenCalled();
	});
	it('does not claim or allocate memory when the dispatcher mutex fails', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([])
			.mockRejectedValue(new Error('mutex failed'));
		const transaction = async (
			work: (manager: EntityManager) => Promise<unknown>
		) => work({ query } as unknown as EntityManager);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.reserveCandidateIds(selected, 8)).rejects.toThrow(
			'mutex failed'
		);
		expect(query).toHaveBeenCalledTimes(2);
	});
	it('returns no claims only after a lock-timeout transaction rolls back', async () => {
		const events: string[] = [];
		const query = jest
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockRejectedValue({ driverError: { code: '55P03' } });
		const transaction = async (
			work: (manager: EntityManager) => Promise<unknown>
		) => {
			try {
				return await work({ query } as unknown as EntityManager);
			} catch (error) {
				events.push('rollback');
				throw error;
			}
		};
		const deferred = jest.fn((code: string) => {
			events.push(code);
		});
		const repository = new HistoryArchiveBrokerFrontierRepository(
			{ transaction } as unknown as DataSource,
			deferred
		);
		await expect(repository.reserveCandidateIds(selected, 8)).resolves.toEqual(
			[]
		);
		expect(events).toEqual(['rollback', '55P03']);
		expect(deferred).toHaveBeenCalledTimes(1);
	});
	it.each(['57014', '40P01', 'XX000'])(
		'propagates non-lock-timeout SQLSTATE %s',
		async (code) => {
			const error = { driverError: { code } };
			const deferred = jest.fn();
			const repository = new HistoryArchiveBrokerFrontierRepository(
				{
					transaction: jest.fn().mockRejectedValue(error)
				} as unknown as DataSource,
				deferred
			);
			await expect(repository.reserveCandidateIds(selected, 8)).rejects.toBe(
				error
			);
			expect(deferred).not.toHaveBeenCalled();
		}
	);
	it('uses the established validated mapper and preserves its public re-export', async () => {
		const row = {
			archiveUrl: 'https://a.example',
			bucketHash: null,
			checkpointLedger: '63',
			claimAttempt: '1',
			dispatchToken: 'token',
			objectKey: 'ledger:63',
			objectType: 'ledger',
			objectUrl: 'https://a.example/63',
			priority: '2',
			remoteId: selected[0]!.remoteId,
			selectedOrdinal: '1'
		};
		const query = jest
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([row]);
		const transaction = async (
			work: (manager: EntityManager) => Promise<unknown>
		) => work({ query } as unknown as EntityManager);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		const jobs = await repository.reserveCandidateIds(selected, 8);
		expect(jobs[0]?.job.checkpointLedger).toBe(63);
		expect(jobs[0]?.job.claimAttempt).toBe(1);
		expect(jobs[0]?.executionId).toBe('token');
		expect(compareHistoryArchiveBrokerJobs(jobs[0]!, jobs[0]!)).toBe(0);
	});
	it('creates the feed without issuing an eager snapshot or hiding its data source', () => {
		const query = jest.fn();
		const repository = new HistoryArchiveBrokerFrontierRepository({
			query
		} as unknown as DataSource);
		expect(repository.createRamCandidateFeed()).toBeInstanceOf(
			HistoryArchiveRamCandidateFeed
		);
		expect(query).not.toHaveBeenCalled();
	});
});
