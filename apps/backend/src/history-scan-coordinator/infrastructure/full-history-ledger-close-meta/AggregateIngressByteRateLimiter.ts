import { performance } from 'node:perf_hooks';

export interface IngressByteRateLimiter {
	throttle(byteCount: number, signal: AbortSignal): Promise<void>;
}

export interface AggregateIngressByteRateLimiterTiming {
	nowMilliseconds(): number;
	wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface AggregateIngressByteRateLimiterOptions {
	readonly bytesPerSecond: number;
	readonly maximumBurstBytes: number;
	readonly timing?: AggregateIngressByteRateLimiterTiming;
}

/**
 * Applies one byte budget to every caller sharing this instance. Reservations
 * are synchronous, so concurrent stream reads cannot each receive a full-rate
 * allowance.
 */
export class AggregateIngressByteRateLimiter implements IngressByteRateLimiter {
	readonly bytesPerSecond: number;
	readonly maximumBurstBytes: number;

	readonly #maximumBurstMilliseconds: number;
	readonly #timing: AggregateIngressByteRateLimiterTiming;
	#lastObservedMilliseconds: number | null = null;
	#scheduledThroughMilliseconds = 0;

	constructor(options: AggregateIngressByteRateLimiterOptions) {
		assertPositiveSafeInteger(options.bytesPerSecond, 'bytesPerSecond');
		assertPositiveSafeInteger(options.maximumBurstBytes, 'maximumBurstBytes');
		if (options.maximumBurstBytes > options.bytesPerSecond) {
			throw new RangeError(
				'maximumBurstBytes cannot exceed one second of the configured byte rate'
			);
		}

		this.bytesPerSecond = options.bytesPerSecond;
		this.maximumBurstBytes = options.maximumBurstBytes;
		this.#maximumBurstMilliseconds =
			(options.maximumBurstBytes * 1_000) / options.bytesPerSecond;
		this.#timing = options.timing ?? systemTiming;
	}

	async throttle(byteCount: number, signal: AbortSignal): Promise<void> {
		assertNonNegativeSafeInteger(byteCount, 'byteCount');
		signal.throwIfAborted();
		if (byteCount === 0) return;

		const now = this.#timing.nowMilliseconds();
		if (!Number.isFinite(now) || now < 0) {
			throw new RangeError(
				'Limiter timing must return finite nonnegative time'
			);
		}
		if (
			this.#lastObservedMilliseconds !== null &&
			now < this.#lastObservedMilliseconds
		) {
			throw new RangeError('Limiter timing must be monotonic');
		}
		this.#lastObservedMilliseconds = now;

		const outstandingMilliseconds = Math.max(
			0,
			this.#scheduledThroughMilliseconds - now
		);
		const reservationMilliseconds = (byteCount * 1_000) / this.bytesPerSecond;
		const totalScheduledMilliseconds =
			outstandingMilliseconds + reservationMilliseconds;
		const scheduledThrough = now + totalScheduledMilliseconds;
		if (!Number.isFinite(scheduledThrough)) {
			throw new RangeError('Byte reservation exceeds the limiter time range');
		}

		this.#scheduledThroughMilliseconds = scheduledThrough;
		const waitMilliseconds = Math.max(
			0,
			totalScheduledMilliseconds - this.#maximumBurstMilliseconds
		);
		if (waitMilliseconds > 0) {
			await this.#timing.wait(waitMilliseconds, signal);
		}
	}
}

const systemTiming: AggregateIngressByteRateLimiterTiming = {
	nowMilliseconds: () => performance.now(),
	wait: waitWithAbort
};

function waitWithAbort(
	milliseconds: number,
	signal: AbortSignal
): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(finish, milliseconds);
		const onAbort = (): void => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			reject(signal.reason);
		};
		function finish(): void {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
	});
}

function assertPositiveSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${field} must be a positive safe integer`);
	}
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${field} must be a nonnegative safe integer`);
	}
}
