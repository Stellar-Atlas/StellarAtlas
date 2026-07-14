interface WaitingPermit {
	readonly reject: (reason?: unknown) => void;
	readonly resolve: (release: () => void) => void;
	readonly signal: AbortSignal;
	readonly onAbort: () => void;
}

export class BoundedAsyncTaskPool {
	readonly #maximumConcurrency: number;
	readonly #maximumQueueDepth: number;
	#active = 0;
	readonly #waiting: WaitingPermit[] = [];

	constructor(maximumConcurrency: number, maximumQueueDepth: number) {
		assertBound(maximumConcurrency, 'maximumConcurrency', 64);
		assertBound(maximumQueueDepth, 'maximumQueueDepth', 4_096);
		this.#maximumConcurrency = maximumConcurrency;
		this.#maximumQueueDepth = maximumQueueDepth;
	}

	get active(): number {
		return this.#active;
	}

	get waiting(): number {
		return this.#waiting.length;
	}

	async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
		const release = await this.#acquire(signal);
		try {
			return await task();
		} finally {
			release();
		}
	}

	#acquire(signal: AbortSignal): Promise<() => void> {
		signal.throwIfAborted();
		if (this.#active < this.#maximumConcurrency) {
			this.#active += 1;
			return Promise.resolve(this.#releaseOnce());
		}
		if (this.#waiting.length >= this.#maximumQueueDepth) {
			return Promise.reject(
				new Error('Bounded async task queue is at its configured capacity')
			);
		}
		return new Promise((resolve, reject) => {
			const waiter: WaitingPermit = {
				onAbort: () => {
					const index = this.#waiting.indexOf(waiter);
					if (index >= 0) this.#waiting.splice(index, 1);
					reject(signal.reason);
				},
				reject,
				resolve,
				signal
			};
			this.#waiting.push(waiter);
			signal.addEventListener('abort', waiter.onAbort, { once: true });
			if (signal.aborted) waiter.onAbort();
		});
	}

	#releaseOnce(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#active -= 1;
			this.#drain();
		};
	}

	#drain(): void {
		while (
			this.#active < this.#maximumConcurrency &&
			this.#waiting.length > 0
		) {
			const waiter = this.#waiting.shift()!;
			waiter.signal.removeEventListener('abort', waiter.onAbort);
			if (waiter.signal.aborted) {
				waiter.reject(waiter.signal.reason);
				continue;
			}
			this.#active += 1;
			waiter.resolve(this.#releaseOnce());
		}
	}
}

function assertBound(value: number, field: string, maximum: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(
			`${field} must be an integer between 1 and ${maximum}`
		);
	}
}
