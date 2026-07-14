import {
	AggregateIngressByteRateLimiter,
	type AggregateIngressByteRateLimiterTiming
} from '../AggregateIngressByteRateLimiter.js';

describe('AggregateIngressByteRateLimiter', () => {
	it('applies one aggregate budget across concurrent reservations', async () => {
		const timing = new RecordingTiming();
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 1_000,
			maximumBurstBytes: 100,
			timing
		});
		const signal = new AbortController().signal;

		await Promise.all([
			limiter.throttle(100, signal),
			limiter.throttle(100, signal),
			limiter.throttle(100, signal)
		]);

		expect(timing.waits).toEqual([100, 200]);
	});

	it('supports an explicit 1.5 Gbit/s aggregate ingress budget', async () => {
		const timing = new RecordingTiming();
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 187_500_000,
			maximumBurstBytes: 18_750_000,
			timing
		});
		const signal = new AbortController().signal;

		await limiter.throttle(18_750_000, signal);
		await limiter.throttle(18_750_000, signal);

		expect(limiter.bytesPerSecond).toBe(187_500_000);
		expect(timing.waits).toEqual([100]);
	});

	it('reclaims scheduled capacity as monotonic time advances', async () => {
		const timing = new RecordingTiming();
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 1_000,
			maximumBurstBytes: 100,
			timing
		});
		const signal = new AbortController().signal;

		await limiter.throttle(100, signal);
		timing.now = 100;
		await limiter.throttle(100, signal);

		expect(timing.waits).toEqual([]);
	});

	it.each([
		{ bytesPerSecond: 0, maximumBurstBytes: 1 },
		{ bytesPerSecond: Number.POSITIVE_INFINITY, maximumBurstBytes: 1 },
		{ bytesPerSecond: 1.5, maximumBurstBytes: 1 },
		{ bytesPerSecond: 100, maximumBurstBytes: 0 },
		{ bytesPerSecond: 100, maximumBurstBytes: Number.POSITIVE_INFINITY },
		{ bytesPerSecond: 100, maximumBurstBytes: 101 }
	])('rejects invalid or effectively unbounded settings %#', (options) => {
		expect(() => new AggregateIngressByteRateLimiter(options)).toThrow(
			RangeError
		);
	});

	it('rejects invalid byte reservations', async () => {
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 1_000,
			maximumBurstBytes: 100
		});
		const signal = new AbortController().signal;

		await expect(limiter.throttle(-1, signal)).rejects.toThrow(RangeError);
		await expect(
			limiter.throttle(Number.POSITIVE_INFINITY, signal)
		).rejects.toThrow(RangeError);
	});

	it('rejects a regressing clock instead of minting capacity', async () => {
		const timing = new RecordingTiming();
		timing.now = 10;
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 1_000,
			maximumBurstBytes: 100,
			timing
		});
		const signal = new AbortController().signal;
		await limiter.throttle(1, signal);

		timing.now = 9;
		await expect(limiter.throttle(1, signal)).rejects.toThrow(
			'Limiter timing must be monotonic'
		);
	});

	it('honors an already-aborted signal without reserving capacity', async () => {
		const timing = new RecordingTiming();
		const limiter = new AggregateIngressByteRateLimiter({
			bytesPerSecond: 1_000,
			maximumBurstBytes: 100,
			timing
		});
		const controller = new AbortController();
		controller.abort(new Error('cancelled'));

		await expect(limiter.throttle(100, controller.signal)).rejects.toThrow(
			'cancelled'
		);
		expect(timing.waits).toEqual([]);
	});
});

class RecordingTiming implements AggregateIngressByteRateLimiterTiming {
	now = 0;
	readonly waits: number[] = [];

	nowMilliseconds(): number {
		return this.now;
	}

	wait(milliseconds: number, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		this.waits.push(milliseconds);
		return Promise.resolve();
	}
}
