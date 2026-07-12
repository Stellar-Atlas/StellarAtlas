import { mockDeep } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import {
	collectFastStatusPatch,
	collectScanLogPatch,
	createBoundedSingleFlightWriter,
	type StatusLiveWebSocketConfig
} from '../StatusLiveWebSocket.js';

describe('StatusLiveWebSocket patch collection', () => {
	it('keeps scan-log drilldown out of the fast runtime patch', async () => {
		const config = mockDeep<StatusLiveWebSocketConfig>();
		config.getApiStatus.execute.mockReturnValue(ok(null as never));
		config.getDataQualityStatus.execute.mockResolvedValue(ok(null as never));
		config.getFrontendStatus.execute.mockReturnValue(ok(null as never));
		config.getWorkerStatus.execute.mockResolvedValue(ok(null as never));

		const patch = await collectFastStatusPatch(config);

		expect(patch).toMatchObject({
			api: null,
			dataQuality: null,
			frontend: null,
			workers: null
		});
		expect(patch).not.toHaveProperty('scanLogs');
		expect(config.getScanLogStatus.execute).not.toHaveBeenCalled();
	});

	it('collects scan logs through their own bounded patch', async () => {
		const config = mockDeep<StatusLiveWebSocketConfig>();
		config.getScanLogStatus.execute.mockResolvedValue(ok(null as never));

		const patch = await collectScanLogPatch(config);

		expect(config.getScanLogStatus.execute).toHaveBeenCalledWith(25);
		expect(patch).toMatchObject({ scanLogs: null });
	});

	it('does not overlap a lane and recovers after its deadline', async () => {
		jest.useFakeTimers();
		const first = deferred<number>();
		const collect = jest
			.fn<Promise<number>, []>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(2);
		const onError = jest.fn();
		const onValue = jest.fn();
		const writer = createBoundedSingleFlightWriter({
			collect,
			deadlineMs: 10,
			onError,
			onValue
		});

		try {
			expect(writer.write()).toBe(true);
			expect(writer.write()).toBe(false);
			await Promise.resolve();
			expect(collect).toHaveBeenCalledTimes(1);
			await jest.advanceTimersByTimeAsync(11);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Status collection exceeded 10ms' })
			);
			expect(writer.write()).toBe(false);
			first.resolve(1);
			await jest.advanceTimersByTimeAsync(0);
			expect(onValue).not.toHaveBeenCalledWith(1);
			expect(writer.write()).toBe(true);
			await jest.advanceTimersByTimeAsync(0);
			expect(collect).toHaveBeenCalledTimes(2);
			expect(onValue).toHaveBeenCalledWith(2);
		} finally {
			jest.useRealTimers();
		}
	});
});

function deferred<T>(): {
	readonly promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(value: T): void {
			resolvePromise?.(value);
		}
	};
}
