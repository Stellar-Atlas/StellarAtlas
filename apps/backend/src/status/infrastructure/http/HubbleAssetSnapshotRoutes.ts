import type { Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import {
	optionalQueryBoolean,
	optionalQueryString,
	parseAsset,
	parseQueryInteger,
	requireStellarAddress,
	requireSupportedHolderQuery,
	semanticSend
} from './HubbleSemanticRouteHelpers.js';

type SnapshotDataset = 'asset_balances' | 'asset_trustlines';

export function registerHubbleAssetSnapshotRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	registerSnapshotRoute(router, warehouse, 'balances', 'asset_balances');
	registerSnapshotRoute(router, warehouse, 'trustlines', 'asset_trustlines');
}

function registerSnapshotRoute(
	router: Router,
	warehouse: HubbleWarehouse,
	kind: 'balances' | 'trustlines',
	dataset: SnapshotDataset
): void {
	router.get('/assets/:asset/' + kind, async (request, response) => {
		await semanticSend(response, async () => {
			requireSupportedHolderQuery(request, [
				'account',
				'after',
				'limit',
				'sort',
				'order',
				'as_of_ledger',
				'include_deleted'
			]);
			const asset = parseAsset(request.params.asset);
			if (kind === 'trustlines' && asset.type === 'native')
				throw new HubbleWarehouseInputError(
					'Asset trustlines require an issued asset'
				);
			const sort = optionalQueryString(request, 'sort') ?? 'account';
			const order = optionalQueryString(request, 'order') ?? 'asc';
			if (sort !== 'account' && sort !== 'balance')
				throw new HubbleWarehouseInputError('sort must be account or balance');
			if (order !== 'asc' && order !== 'desc')
				throw new HubbleWarehouseInputError('order must be asc or desc');
			const rawLedger = optionalQueryString(request, 'as_of_ledger');
			const rawAccount = optionalQueryString(request, 'account');
			const page = await warehouse.assetHolders({
				asset,
				account: rawAccount
					? requireStellarAddress(rawAccount, 'account')
					: undefined,
				after: optionalQueryString(request, 'after'),
				limit: parseQueryInteger(request, 'limit', 100, 1, 200),
				sort,
				order,
				asOfLedger: rawLedger
					? parseQueryInteger(request, 'as_of_ledger', 1, 1, 4294967295)
					: undefined,
				balanceFilter: 'all',
				includeDeleted:
					optionalQueryBoolean(request, 'include_deleted') ?? false
			});
			return { ...page, dataset };
		});
	});
}
