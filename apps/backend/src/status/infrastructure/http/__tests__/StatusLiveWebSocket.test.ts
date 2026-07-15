import { mockDeep } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import {
	collectFastStatusPatch,
	collectArchiveSummaryPatch,
	collectScanLogPatch,
	createBoundedSingleFlightWriter,
	type StatusLiveWebSocketConfig
} from '../StatusLiveWebSocket.js';

describe('StatusLiveWebSocket patch collection', () => {
	it('keeps full-history aggregates and scan logs out of the fast patch', async () => {
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
		expect(patch).not.toHaveProperty('fullHistory');
		expect(patch).not.toHaveProperty('scanLogs');
		expect(
			config.getFullHistoryStatus.executeFullHistory
		).not.toHaveBeenCalled();
		expect(config.getScanLogStatus.execute).not.toHaveBeenCalled();
	});

	it('collects scan logs through their own bounded patch', async () => {
		const config = mockDeep<StatusLiveWebSocketConfig>();
		config.getScanLogStatus.execute.mockResolvedValue(ok(null as never));

		const patch = await collectScanLogPatch(config);

		expect(config.getScanLogStatus.execute).toHaveBeenCalledWith(25);
		expect(patch).toMatchObject({ scanLogs: null });
	});

	it('publishes archive proof and canonical history in one slow patch', async () => {
		const config = mockDeep<StatusLiveWebSocketConfig>();
		config.getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(null as never)
		);
		config.getFullHistoryStatus.executeFullHistory.mockResolvedValue(
			ok(null as never)
		);

		const patch = await collectArchiveSummaryPatch(config);

		expect(patch).toMatchObject({
			archiveSummary: null,
			fullHistory: null
		});
	});

	it('does not overlap a lane and publishes when collection completes', async () => {
		const first = deferred<number>();
		const collect = jest
			.fn<Promise<number>, []>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(2);
		const onError = jest.fn();
		const onValue = jest.fn();
		const writer = createBoundedSingleFlightWriter({
			collect,
			onError,
			onValue
		});

		expect(writer.write()).toBe(true);
		expect(writer.write()).toBe(false);
		await Promise.resolve();
		expect(collect).toHaveBeenCalledTimes(1);
		expect(onError).not.toHaveBeenCalled();
		first.resolve(1);
		await new Promise((resolve) => setImmediate(resolve));
		expect(onValue).toHaveBeenCalledWith(1);
		expect(writer.write()).toBe(true);
		await new Promise((resolve) => setImmediate(resolve));
		expect(collect).toHaveBeenCalledTimes(2);
		expect(onValue).toHaveBeenCalledWith(2);
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
