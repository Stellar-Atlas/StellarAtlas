import type { Logger } from '@core/services/Logger.js';
import type { NetworkSearchInventoryLoader } from './NetworkSearchInventoryLoader.js';
import type { NetworkSearchService } from './NetworkSearchService.js';
import { networkSearchProjectionRefreshIntervalMs } from './NetworkSearchProjectionState.js';

export { networkSearchProjectionRefreshIntervalMs } from './NetworkSearchProjectionState.js';

interface NetworkSearchProjectionRefresherOptions {
	readonly enabled: boolean;
	readonly refreshIntervalMs?: number;
}

type InventoryLoader = Pick<NetworkSearchInventoryLoader, 'load'>;
type ProjectionWriter = Pick<NetworkSearchService, 'refreshProjection'>;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export class NetworkSearchProjectionRefresher {
	private activeRefresh: Promise<void> | undefined;
	private readonly enabled: boolean;
	private readonly refreshIntervalMs: number;
	private started = false;
	private stopped = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly inventoryLoader: InventoryLoader,
		private readonly projectionWriter: ProjectionWriter,
		private readonly logger: Logger | undefined,
		options: NetworkSearchProjectionRefresherOptions
	) {
		this.enabled = options.enabled;
		this.refreshIntervalMs =
			options.refreshIntervalMs ?? networkSearchProjectionRefreshIntervalMs;
		if (
			!Number.isSafeInteger(this.refreshIntervalMs) ||
			this.refreshIntervalMs < 1
		) {
			throw new Error(
				'Network search refresh interval must be a positive integer'
			);
		}
	}

	start(): void {
		if (!this.enabled || this.started || this.stopped) return;
		this.started = true;
		this.schedule(0);
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.clearTimer();
	}

	private beginRefresh(): void {
		if (this.stopped || this.activeRefresh) return;
		const activeRefresh = this.refresh().finally(() => {
			if (this.activeRefresh !== activeRefresh) return;
			this.activeRefresh = undefined;
			if (this.stopped) return;
			this.schedule(this.refreshIntervalMs);
		});
		this.activeRefresh = activeRefresh;
		void activeRefresh;
	}

	private async refresh(): Promise<void> {
		try {
			const inventoryOrError = await this.inventoryLoader.load();
			if (this.stopped) return;
			if (inventoryOrError.isErr()) {
				this.logFailure(inventoryOrError.error);
				return;
			}
			if (inventoryOrError.value !== null) {
				await this.projectionWriter.refreshProjection(inventoryOrError.value);
			}
		} catch (error: unknown) {
			this.logFailure(error);
		}
	}

	private logFailure(error: unknown): void {
		this.logger?.warn('Network search projection refresh failed', {
			error: errorMessage(error)
		});
	}

	private schedule(delayMs: number): void {
		if (this.stopped) return;
		if (this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.beginRefresh();
		}, delayMs);
		this.timer.unref();
	}

	private clearTimer(): void {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}
