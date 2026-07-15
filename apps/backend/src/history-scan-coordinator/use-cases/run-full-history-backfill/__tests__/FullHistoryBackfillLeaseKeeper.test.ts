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

	it('aborts bounded work and surfaces renewal failure immediately', async () => {
		const leaseError = new Error('historical backfill lease was lost');
		const renew = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(leaseError);
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew,
			work: (signal) =>
				new Promise<void>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), {
						once: true
					});
				})
		});
		const rejection = expect(execution).rejects.toBe(leaseError);
		await jest.advanceTimersByTimeAsync(1_000);

		await rejection;
		expect(jest.getTimerCount()).toBe(0);
	});

	it('settles an in-flight renewal before running a terminal transition', async () => {
		const renewalStarted = deferred<void>();
		const blockedRenewal = deferred<void>();
		const beginTerminal = deferred<void>();
		const terminalTransition = jest.fn().mockResolvedValue('completed');
		const renew = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockImplementationOnce(async () => {
				renewalStarted.resolve();
				return blockedRenewal.promise;
			});
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew,
			work: async (_signal, terminal) => {
				await beginTerminal.promise;
				return terminal.run(terminalTransition);
			}
		});
		await jest.advanceTimersByTimeAsync(1_000);
		await renewalStarted.promise;

		beginTerminal.resolve();
		await jest.advanceTimersByTimeAsync(0);
		expect(terminalTransition).not.toHaveBeenCalled();

		blockedRenewal.resolve();
		await expect(execution).resolves.toBe('completed');
		expect(terminalTransition).toHaveBeenCalledTimes(1);
		expect(renew).toHaveBeenCalledTimes(2);
		expect(jest.getTimerCount()).toBe(0);
	});

	it('does not suppress lease loss while settling for a terminal transition', async () => {
		const leaseError = new Error('lease expired during blocked renewal');
		const renewalStarted = deferred<void>();
		const blockedRenewal = deferred<void>();
		const beginTerminal = deferred<void>();
		const terminalTransition = jest.fn().mockResolvedValue('completed');
		const renew = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockImplementationOnce(async () => {
				renewalStarted.resolve();
				return blockedRenewal.promise;
			});
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew,
			work: async (_signal, terminal) => {
				await beginTerminal.promise;
				return terminal.run(terminalTransition);
			}
		});
		const rejection = expect(execution).rejects.toBe(leaseError);
		await jest.advanceTimersByTimeAsync(1_000);
		await renewalStarted.promise;

		beginTerminal.resolve();
		await jest.advanceTimersByTimeAsync(0);
		blockedRenewal.reject(leaseError);

		await rejection;
		expect(terminalTransition).not.toHaveBeenCalled();
		expect(jest.getTimerCount()).toBe(0);
	});

	it('allows only one terminal transition', async () => {
		const execution = runWithFullHistoryBackfillLease({
			leaseDurationMs: 3_000,
			renew: jest.fn().mockResolvedValue(undefined),
			work: async (_signal, terminal) => {
				await terminal.run(async () => undefined);
				return terminal.run(async () => 'completed');
			}
		});

		await expect(execution).rejects.toThrow(
			'Full-history lease terminal transition already started'
		);
		expect(jest.getTimerCount()).toBe(0);
	});
});

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly reject: (reason: unknown) => void;
	readonly resolve: (value: Value) => void;
} {
	let resolvePromise: ((value: Value) => void) | undefined;
	let rejectPromise: ((reason: unknown) => void) | undefined;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		reject: (reason) => {
			if (rejectPromise === undefined) throw new Error('Deferred is not ready');
			rejectPromise(reason);
		},
		resolve: (value) => {
			if (resolvePromise === undefined)
				throw new Error('Deferred is not ready');
			resolvePromise(value);
		}
	};
}
