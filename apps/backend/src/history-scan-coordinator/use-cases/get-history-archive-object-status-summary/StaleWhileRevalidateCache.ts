export class StaleWhileRevalidateCache<T> {
	private cached: { value: T; cachedAt: number } | undefined;
	private inflight: Promise<T> | undefined;
	private lastError: unknown;
	private retryAfter = 0;

	constructor(
		private readonly freshForMs: number,
		private readonly maxStaleForMs: number,
		private readonly retryDelayMs: number,
		private readonly now: () => number = Date.now
	) {}

	get(
		loader: () => Promise<T>,
		onError?: (error: unknown) => void
	): Promise<T> {
		const currentTime = this.now();
		const cached = this.cached;
		const age = cached
			? currentTime - cached.cachedAt
			: Number.POSITIVE_INFINITY;

		if (cached && age <= this.freshForMs) return Promise.resolve(cached.value);
		if (this.inflight) {
			return cached && age <= this.maxStaleForMs
				? Promise.resolve(cached.value)
				: this.inflight;
		}

		if (cached && age <= this.maxStaleForMs) {
			if (currentTime >= this.retryAfter) {
				void this.refresh(loader, onError).catch(() => undefined);
			}
			return Promise.resolve(cached.value);
		}

		if (currentTime < this.retryAfter && this.lastError !== undefined) {
			return Promise.reject(this.lastError);
		}
		return this.refresh(loader, onError);
	}

	private refresh(
		loader: () => Promise<T>,
		onError?: (error: unknown) => void
	): Promise<T> {
		const request = loader().then(
			(value) => {
				this.cached = { value, cachedAt: this.now() };
				this.lastError = undefined;
				this.retryAfter = 0;
				return value;
			},
			(error: unknown) => {
				onError?.(error);
				this.lastError = error;
				this.retryAfter = this.now() + this.retryDelayMs;
				throw error;
			}
		);
		this.inflight = request;
		void request
			.finally(() => {
				if (this.inflight === request) this.inflight = undefined;
			})
			.catch(() => undefined);
		return request;
	}
}
