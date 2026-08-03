export interface FullHistoryStateRegistrationTasks {
	readonly registerCoverage: () => Promise<number>;
	readonly registerImports: () => Promise<number>;
}

export class FullHistoryStateRegistrationCoordinator {
	private inFlight: Promise<void> | null = null;
	private nextRefreshAt = 0;

	constructor(
		private readonly tasks: FullHistoryStateRegistrationTasks,
		private readonly refreshIntervalMilliseconds: number,
		private readonly now: () => number = Date.now
	) {
		if (
			!Number.isInteger(refreshIntervalMilliseconds) ||
			refreshIntervalMilliseconds < 1_000
		) {
			throw new TypeError(
				'State registration interval must be at least 1 second'
			);
		}
	}

	async refresh(): Promise<void> {
		if (this.inFlight !== null) return this.inFlight;
		if (this.now() < this.nextRefreshAt) return;

		const refresh = this.runRefresh();
		this.inFlight = refresh;
		try {
			await refresh;
		} finally {
			if (this.inFlight === refresh) this.inFlight = null;
		}
	}

	private async runRefresh(): Promise<void> {
		this.nextRefreshAt = this.now() + this.refreshIntervalMilliseconds;
		await this.tasks.registerImports();
		await this.tasks.registerCoverage();
	}
}
