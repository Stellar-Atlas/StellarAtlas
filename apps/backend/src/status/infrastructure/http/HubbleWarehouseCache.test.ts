import { HubbleWarehouseCache } from './HubbleWarehouseCache.js';
import type {
	HubbleCatalog
} from './HubbleWarehouseContracts.js';
import type {
	HubbleAssetHolderQuery,
	HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

describe('HubbleWarehouseCache holder-page expiry', () => {
	it('starts the result TTL after a long holder query settles', async () => {
		let currentTime = 1_000;
		const clock = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
		let resolveQuery!: (value: { data: readonly Record<string, unknown>[] }) => void;
		const execute = jest.fn(
			() =>
				new Promise<{ data: readonly Record<string, unknown>[] }>((resolve) => {
					resolveQuery = resolve;
				})
		);
		const executor = {
			database: 'stellar_hubble',
			maximumRows: 1_000,
			execute
		} as unknown as HubbleSemanticQueryExecutor;
		const input = {
			asset: { type: 'native' },
			limit: 25
		} as HubbleAssetHolderQuery;
		const catalog = {
			generatedAt: '2026-10-12T00:00:00.000Z',
			coverage: { maximumLedger: '193' }
		} as unknown as Pick<HubbleCatalog, 'coverage' | 'generatedAt'>;
		const cache = new HubbleWarehouseCache();

		try {
			const first = cache.getAssetHolders('stellar_hubble', input, catalog, executor);
			currentTime += 31_000;
			resolveQuery({ data: [{ account_id: 'G' + 'A'.repeat(55), balance: 1 }] });
			await first;

			const cached = cache.getAssetHolders(
				'stellar_hubble',
				input,
				catalog,
				executor
			);
			expect(execute).toHaveBeenCalledTimes(1);
			await cached;
		} finally {
			clock.mockRestore();
		}
	});
});
