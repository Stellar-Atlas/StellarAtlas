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
	it('continues after an invalid summary without dropping later due roots', async () => {
		const refresh = jest
			.fn()
			.mockResolvedValueOnce({
				root: 'Root',
				errorCode: 'SUMMARY_REFRESH_FAILED'
			})
			.mockResolvedValue(null);
		const report = jest.fn();
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, report);
		await jest.advanceTimersByTimeAsync(1_000);
		expect(report).toHaveBeenCalledWith({ code: 'SUMMARY_REFRESH_FAILED' });
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
	it.each([
		'57014',
		'55P03',
		'40P01',
		'40001',
		'08006',
		'53300',
		'58030',
		'57P01'
	])(
		'backs off a durably recorded aggregate infrastructure error %s',
		async (errorCode) => {
			const refresh = jest
				.fn()
				.mockResolvedValueOnce({ root: 'Cold', errorCode })
				.mockResolvedValue({ root: 'Next due root', errorCode: null });
			const report = jest.fn();
			const stop = startArchiveFailureSummaryRefreshLoop(refresh, report);
			await jest.advanceTimersByTimeAsync(299_999);
			expect(refresh).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith({ code: errorCode });
			await jest.advanceTimersByTimeAsync(1);
			expect(refresh).toHaveBeenCalledTimes(2);
			await jest.advanceTimersByTimeAsync(1_000);
			expect(refresh).toHaveBeenCalledTimes(3);
			stop();
		}
	);
	it('shares bounded exponential backoff across aggregate and outer errors and resets after success', async () => {
		const refresh = jest
			.fn()
			.mockResolvedValueOnce({ root: 'First', errorCode: '57014' })
			.mockRejectedValueOnce({ code: '08006' })
			.mockResolvedValueOnce({ root: 'Second', errorCode: '57014' })
			.mockResolvedValueOnce({ root: 'Third', errorCode: '57014' })
			.mockResolvedValueOnce({ root: 'Healthy', errorCode: null })
			.mockResolvedValueOnce({ root: 'Fourth', errorCode: '57014' })
			.mockResolvedValue(null);
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
		for (const [delay, calls] of [
			[300_000, 1],
			[600_000, 2],
			[900_000, 3],
			[900_000, 4],
			[1_000, 5],
			[300_000, 6]
		]) {
			await jest.advanceTimersByTimeAsync(delay - 1);
			expect(refresh).toHaveBeenCalledTimes(calls);
			await jest.advanceTimersByTimeAsync(1);
			expect(refresh).toHaveBeenCalledTimes(calls + 1);
		}
		stop();
	});
	it.each(['404', '429', '500', '503', 'ARCHIVE_HTTP_ERROR'])(
		'does not treat archive status %s as a PostgreSQL infrastructure failure',
		async (errorCode) => {
			const refresh = jest
				.fn()
				.mockResolvedValue({ root: 'Archive', errorCode });
			const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
			await jest.advanceTimersByTimeAsync(1_000);
			expect(refresh).toHaveBeenCalledTimes(2);
			stop();
		}
	);
	it('stops while an aggregate cooldown is pending', async () => {
		const refresh = jest
			.fn()
			.mockResolvedValue({ root: 'Cold', errorCode: '57014' });
		const stop = startArchiveFailureSummaryRefreshLoop(refresh, jest.fn());
		await jest.advanceTimersByTimeAsync(1);
		stop();
		await jest.advanceTimersByTimeAsync(900_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
