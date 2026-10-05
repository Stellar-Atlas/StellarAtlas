import { startArchiveFailureSummaryRefreshLoop } from '../KnownArchiveFailureSummaryRefresh.js';

describe('single-flight due-source failure summary refresh', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());
	it('never overlaps a slow root and stops scheduling after shutdown', async () => {
		let finish:
			((value: { root: string; errorCode: null }) => void) | undefined;
		const refresh = jest.fn(
			() =>
				new Promise<{ root: string; errorCode: null }>((resolve) => {
					finish = resolve;
				})
		);
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
		await jest.advanceTimersByTimeAsync(60_000);
		expect(refresh).toHaveBeenCalledTimes(1);
		stop();
		finish?.({ root: 'Root', errorCode: null });
		await jest.advanceTimersByTimeAsync(60_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it('checks no-due state at a quiet interval, not one query per second forever', async () => {
		const refresh = jest.fn(async () => null);
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
		await jest.advanceTimersByTimeAsync(29_999);
		expect(refresh).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(1);
		expect(refresh).toHaveBeenCalledTimes(2);
		stop();
	});
	it('continues after a bounded source failure without dropping later due roots', async () => {
		const refresh = jest
			.fn()
			.mockResolvedValueOnce({ root: 'Root', errorCode: '57014' })
			.mockResolvedValue(null);
		const report = jest.fn();
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, report);
		await jest.advanceTimersByTimeAsync(1_000);
		expect(report).toHaveBeenCalledWith({ code: '57014' });
		expect(refresh).toHaveBeenCalledTimes(2);
		stop();
	});
	it('backs off infrastructure errors from five to fifteen minutes and resets after recovery', async () => {
		const error = { code: '08006' };
		const refresh = jest
			.fn()
			.mockRejectedValueOnce(error)
			.mockRejectedValueOnce(error)
			.mockRejectedValueOnce(error)
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({ root: 'Healthy', errorCode: null })
			.mockRejectedValueOnce(error)
			.mockResolvedValue(null);
		const report = jest.fn();
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, report);
		for (const [delay, calls] of [
			[300_000, 1],
			[600_000, 2],
			[900_000, 3],
			[900_000, 4]
		]) {
			await jest.advanceTimersByTimeAsync(delay - 1);
			expect(refresh).toHaveBeenCalledTimes(calls);
			await jest.advanceTimersByTimeAsync(1);
			expect(refresh).toHaveBeenCalledTimes(calls + 1);
		}
		await jest.advanceTimersByTimeAsync(1_000);
		expect(refresh).toHaveBeenCalledTimes(6);
		await jest.advanceTimersByTimeAsync(299_999);
		expect(refresh).toHaveBeenCalledTimes(6);
		await jest.advanceTimersByTimeAsync(1);
		expect(refresh).toHaveBeenCalledTimes(7);
		expect(report).toHaveBeenCalledTimes(5);
		stop();
	});
	it('cancels the infrastructure-error backoff on shutdown', async () => {
		const refresh = jest.fn().mockRejectedValue({ code: '08006' });
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
		await jest.advanceTimersByTimeAsync(1);
		stop();
		await jest.advanceTimersByTimeAsync(900_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
