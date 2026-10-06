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
	it('locks dispatcher then sets local memory and claims only supplied IDs without hydration', async () => {
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
		expect(query).toHaveBeenCalledTimes(3);
		expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
		expect(query.mock.calls[1]?.[0]).toBe("set local work_mem = '32MB'");
		expect(query.mock.calls[2]?.[0]).toContain('ram_input as materialized');
		expect(query.mock.calls[2]?.[0]).not.toContain('fresh_root_minimum');
		expect(query.mock.calls[2]?.[1]).toEqual([
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
		const query = jest.fn().mockRejectedValue(new Error('mutex failed'));
		const transaction = async (
			work: (manager: EntityManager) => Promise<unknown>
		) => work({ query } as unknown as EntityManager);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.reserveCandidateIds(selected, 8)).rejects.toThrow(
			'mutex failed'
		);
		expect(query).toHaveBeenCalledTimes(1);
	});
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
