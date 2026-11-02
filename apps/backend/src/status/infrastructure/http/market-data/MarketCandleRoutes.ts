import type { Router } from 'express';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';
import { semanticSend } from '../HubbleSemanticRouteHelpers.js';
import { parseMarketCandleInput } from './MarketCandleValidation.js';
import { MarketCandleService } from './MarketCandleService.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';

export function registerMarketCandleRoutes(
	router: Router,
	warehouse: HubbleWarehouse,
	executor: () =>
		HubbleSemanticQueryExecutor | Promise<HubbleSemanticQueryExecutor>
): void {
	const service = new MarketCandleService(warehouse, executor);
	router.get('/markets/:base/:quote/candles', async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		await semanticSend(response, async () => {
			try {
				return await service.candles(
					parseMarketCandleInput(
						request.params.base,
						request.params.quote,
						request.query
					)
				);
			} catch (error) {
				if (error instanceof HubbleWarehouseUnavailableError)
					response.setHeader('Retry-After', '3');
				throw error;
			}
		});
	});
}
