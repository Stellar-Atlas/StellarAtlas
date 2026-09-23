import type { Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	requireBalanceAccount,
	decodeBalanceCursor
} from './HubbleAccountBalanceCursor.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import {
	optionalQueryString,
	parseQueryInteger,
	semanticSend
} from './HubbleSemanticRouteHelpers.js';

export function registerHubbleAccountBalanceRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	router.get('/accounts/:account/balances', async (request, response) => {
		await semanticSend(response, async () => {
			for (const key of Object.keys(request.query))
				if (!['after', 'limit'].includes(key))
					throw new HubbleWarehouseInputError(
						'Unsupported balance parameter: ' +
							key +
							'; current/as-of state is not supported'
					);
			const account = requireBalanceAccount(request.params.account),
				after = optionalQueryString(request, 'after');
			decodeBalanceCursor(account, after);
			return warehouse.accountBalances({
				account,
				after,
				limit: parseQueryInteger(request, 'limit', 100, 1, 200)
			});
		});
	});
}
