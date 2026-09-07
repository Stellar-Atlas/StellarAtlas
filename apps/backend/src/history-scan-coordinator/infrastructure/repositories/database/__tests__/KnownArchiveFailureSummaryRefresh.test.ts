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
});
