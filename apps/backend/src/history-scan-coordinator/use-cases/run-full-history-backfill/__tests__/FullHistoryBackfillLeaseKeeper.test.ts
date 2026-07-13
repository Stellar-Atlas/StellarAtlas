import { runWithFullHistoryBackfillLease } from '../FullHistoryBackfillLeaseKeeper.js';

describe('runWithFullHistoryBackfillLease', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('renews before work and throughout a long checkpoint promotion', async () => {
		const work = deferred<string>();
		const renew = jest.fn().mockResolvedValue(undefined);
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew,
			work: () => work.promise
		});
		await jest.advanceTimersByTimeAsync(0);
		expect(renew).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(2_000);
		expect(renew).toHaveBeenCalledTimes(3);
		work.resolve('promoted');

		await expect(execution).resolves.toBe('promoted');
		expect(jest.getTimerCount()).toBe(0);
	});

	it('surfaces renewal failure after bounded work finishes', async () => {
		const work = deferred<void>();
		const leaseError = new Error('historical backfill lease was lost');
		const renew = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(leaseError);
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew,
			work: () => work.promise
		});
		await jest.advanceTimersByTimeAsync(1_000);
		work.resolve();

		await expect(execution).rejects.toBe(leaseError);
		expect(jest.getTimerCount()).toBe(0);
	});
});

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
} {
	let resolvePromise: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => {
			if (resolvePromise === undefined) throw new Error('Deferred is not ready');
			resolvePromise(value);
		}
	};
}
