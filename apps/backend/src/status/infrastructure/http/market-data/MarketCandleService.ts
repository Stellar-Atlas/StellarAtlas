import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';
import type {
	MarketCandleInput,
	MarketCandlePage
} from './MarketCandleContracts.js';
import { queryMarketCandles } from './MarketCandleQuery.js';

interface CachedPage {
	readonly page: MarketCandlePage;
	readonly expires: number;
}

/** Small process-local read cache: 32 pages, no disk allocation or background backfill. */
export class MarketCandleService {
	private readonly cache = new Map<string, CachedPage>();
	private readonly pending = new Map<string, Promise<MarketCandlePage>>();
	private active = false;
	private readonly waiters: Array<{
		start: () => void;
		timer: NodeJS.Timeout;
	}> = [];
	constructor(
		private readonly warehouse: HubbleWarehouse,
		private readonly executor: () =>
			HubbleSemanticQueryExecutor | Promise<HubbleSemanticQueryExecutor>
	) {}
	async candles(input: MarketCandleInput): Promise<MarketCandlePage> {
		const key = JSON.stringify(input);
		const hit = this.cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.page;
		const running = this.pending.get(key);
		if (running) return running;
		const promise = this.acquire()
			.then(async () => {
				try {
					return await queryMarketCandles(
						this.warehouse,
						await this.executor(),
						input
					);
				} finally {
					this.release();
				}
			})
			.then((page) => {
				this.cache.delete(key);
				this.cache.set(key, { page, expires: Date.now() + 30_000 });
				while (this.cache.size > 32)
					this.cache.delete(this.cache.keys().next().value!);
				return page;
			})
			.finally(() => {
				this.pending.delete(key);
			});
		this.pending.set(key, promise);
		return promise;
	}
	private acquire(): Promise<void> {
		if (!this.active) {
			this.active = true;
			return Promise.resolve();
		}
		if (this.waiters.length >= 4)
			return Promise.reject(
				new HubbleWarehouseUnavailableError(
					'Market query capacity is busy; retry shortly'
				)
			);
		return new Promise((resolve, reject) => {
			const entry = {
				start: resolve,
				timer: setTimeout(() => {
					const index = this.waiters.indexOf(entry);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(
						new HubbleWarehouseUnavailableError(
							'Market query queue deadline exceeded; retry shortly'
						)
					);
				}, 8_000)
			};
			this.waiters.push(entry);
		});
	}
	private release(): void {
		const next = this.waiters.shift();
		if (next) {
			clearTimeout(next.timer);
			next.start();
		} else this.active = false;
	}
}
