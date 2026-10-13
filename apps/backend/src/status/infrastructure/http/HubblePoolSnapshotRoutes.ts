import type { NextFunction, Request, Response, Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import {
	optionalQueryBoolean,
	optionalQueryString,
	parseQueryInteger,
	semanticSend
} from './HubbleSemanticRouteHelpers.js';
import {
	queryHubblePoolSnapshot,
	type PoolOrderBy
} from './HubblePoolSnapshotQuery.js';
import type { HubbleSemanticQueryExecutor } from './HubbleSemanticWarehouse.js';

export type HubblePoolExecutorProvider = () =>
	HubbleSemanticQueryExecutor | Promise<HubbleSemanticQueryExecutor>;
const orderFields = new Set<PoolOrderBy>([
	'pool',
	'asset_a',
	'asset_b',
	'reserve_a',
	'reserve_b',
	'shares',
	'trustlines',
	'fee',
	'ledger',
	'time'
]);
const supported = new Set([
	'after',
	'asset',
	'asset_a',
	'asset_b',
	'deleted',
	'limit',
	'order_by',
	'order'
]);
const historical = new Set([
	'min_ledger',
	'max_ledger',
	'start_time',
	'end_time',
	'offset'
]);

export function registerHubblePoolSnapshotRoutes(
	router: Router,
	warehouse: HubbleWarehouse,
	executorProvider: HubblePoolExecutorProvider
): void {
	registerRoute(router, warehouse, executorProvider, false);
	registerRoute(router, warehouse, executorProvider, true);
}

function registerRoute(
	router: Router,
	warehouse: HubbleWarehouse,
	executorProvider: HubblePoolExecutorProvider,
	detail: boolean
): void {
	router.get(
		'/liquidity-pools' + (detail ? '/:id' : ''),
		async (request: Request, response: Response, next: NextFunction) => {
			if (Object.keys(request.query).some((key) => historical.has(key))) {
				next();
				return;
			}
			await semanticSend(response, async () => {
				for (const key of Object.keys(request.query))
					if (!supported.has(key))
						throw new HubbleWarehouseInputError(
							'Unsupported liquidity-pools parameter: ' + key
						);
				const orderBy =
					optionalQueryString(request, 'order_by') ?? 'trustlines';
				if (!orderFields.has(orderBy as PoolOrderBy))
					throw new HubbleWarehouseInputError(
						'order_by must be pool, asset_a, asset_b, reserve_a, reserve_b, shares, trustlines, fee, ledger, or time'
					);
				const order = optionalQueryString(request, 'order') ?? 'desc';
				if (order !== 'asc' && order !== 'desc')
					throw new HubbleWarehouseInputError('order must be asc or desc');
				const executor = await executorProvider();
				return queryHubblePoolSnapshot(warehouse, executor, {
					id: detail ? request.params.id : undefined,
					limit: parseQueryInteger(request, 'limit', 25, 1, 100),
					after: optionalQueryString(request, 'after'),
					orderBy: orderBy as PoolOrderBy,
					order,
					asset: optionalQueryString(request, 'asset'),
					assetA: optionalQueryString(request, 'asset_a'),
					assetB: optionalQueryString(request, 'asset_b'),
					deleted: optionalQueryBoolean(request, 'deleted') ?? false
				});
			});
		}
	);
}
