import type { KnownArchiveFailureSummaryV1 } from 'shared';
import {
	KnownArchiveFailureSummaryCache,
	unavailableArchiveFailureSummary
} from '../KnownArchiveFailureSummaryCache.js';

const summary: KnownArchiveFailureSummaryV1 = {
	...unavailableArchiveFailureSummary,
	status: 'current',
	computedAt: '2026-09-07T00:00:00Z',
	totalGroups: 0,
	remainingGroupCount: 0,
	remainingFailureCount: 0,
	remoteFailureCount: 0,
	workerIssueCount: 0
};
describe('bounded source reason summary cache', () => {
	it('coalesces concurrent requests and refreshes only after five minutes', async () => {
		let now = 0;
		const load = jest.fn(async (_root: string) => summary);
		const cache = new KnownArchiveFailureSummaryCache(load, () => now);
		expect(await Promise.all([cache.get('Root'), cache.get('Root')])).toEqual([
			summary,
			summary
		]);
		now = 299_999;
		await cache.get('Root');
		expect(load).toHaveBeenCalledTimes(1);
		now = 300_000;
		await cache.get('Root');
		expect(load).toHaveBeenCalledTimes(2);
	});
	it('retains an explicitly stale snapshot after errors and briefly caches failure', async () => {
		let now = 0;
		const load = jest
			.fn<Promise<KnownArchiveFailureSummaryV1>, [string]>()
			.mockResolvedValueOnce(summary)
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValue(summary);
		const cache = new KnownArchiveFailureSummaryCache(load, () => now);
		await cache.get('Root');
		now = 300_000;
		expect(await cache.get('Root')).toEqual({ ...summary, status: 'stale' });
		now += 14_999;
		expect((await cache.get('Root')).computedAt).toBe(summary.computedAt);
		expect(load).toHaveBeenCalledTimes(2);
		now += 1;
		expect((await cache.get('Root')).status).toBe('current');
	});
	it('reports unavailable, not zero, without a successful snapshot', async () => {
		const load = jest.fn(async () => {
			throw new Error('unavailable');
		});
		const cache = new KnownArchiveFailureSummaryCache(load);
		expect(await cache.get('Root')).toEqual(unavailableArchiveFailureSummary);
		await cache.get('Root');
		expect(load).toHaveBeenCalledTimes(1);
	});
	it('bounds roots and preserves case-sensitive identities', async () => {
		const load = jest.fn(async (_root: string) => summary);
		const cache = new KnownArchiveFailureSummaryCache(load, () => 0, 2);
		await cache.get('Root');
		await cache.get('root');
		await cache.get('third');
		await cache.get('Root');
		expect(load.mock.calls.map(([root]) => root)).toEqual([
			'Root',
			'root',
			'third',
			'Root'
		]);
	});
	it('does not evict active work or start extra queries when every slot is busy', async () => {
		let finish: ((value: KnownArchiveFailureSummaryV1) => void) | undefined;
		const cache = new KnownArchiveFailureSummaryCache(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			() => 0,
			1
		);
		const first = cache.get('Root');
		await Promise.resolve();
		expect(await cache.get('other')).toEqual(unavailableArchiveFailureSummary);
		finish?.(summary);
		expect(await first).toEqual(summary);
	});
});
