import type { Request, Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import { queryExplorer } from './HubbleExplorerQuery.js';

export function registerHubbleExplorerRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	for (const entity of [
		'operations',
		'assets',
		'contracts',
		'trades',
		'offers'
	] as const) {
		for (const detail of [false, true]) {
			router.get(
				'/' + entity + (detail ? '/:id' : ''),
				async (request, response, next) => {
					if (
						((entity === 'trades' && !detail) ||
							(entity === 'operations' && detail)) &&
						request.query.view !== 'typed'
					) {
						next();
						return;
					}
					try {
						const filters: Record<string, string> = {};
						const reserved = new Set([
							'view',
							'min_ledger',
							'max_ledger',
							'limit',
							'offset',
							'start_time',
							'end_time'
						]);
						for (const key of Object.keys(request.query))
							if (!reserved.has(key)) filters[key] = text(request, key)!;
						const result = await queryExplorer(warehouse, {
							entity,
							id: detail ? request.params.id : undefined,
							filters,
							minLedger: number(request, 'min_ledger'),
							maxLedger: number(request, 'max_ledger'),
							limit: number(request, 'limit'),
							offset: number(request, 'offset'),
							startTime: text(request, 'start_time'),
							endTime: text(request, 'end_time')
						});
						response.setHeader('Cache-Control', 'no-store');
						if (detail && result.record === null) {
							response
								.status(result.coverageStatus === 'complete' ? 404 : 409)
								.json({
									...result,
									code:
										result.coverageStatus === 'complete'
											? 'hubble_record_not_found'
											: 'hubble_range_not_fully_ingested',
									error: 'Record was not found in the selected parsed window'
								});
							return;
						}
						response.json(result);
					} catch (error) {
						if (error instanceof HubbleWarehouseInputError) {
							response
								.status(400)
								.json({ code: 'invalid_hubble_query', error: error.message });
							return;
						}
						console.error('Hubble explorer query failed', error);
						response
							.status(
								error instanceof HubbleWarehouseUnavailableError ? 503 : 500
							)
							.json({
								code: 'hubble_warehouse_unavailable',
								error: 'The parsed warehouse query could not be completed'
							});
					}
				}
			);
		}
	}
}
function text(request: Request, key: string): string | undefined {
	const value = request.query[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value === '' || value.length > 2048)
		throw new HubbleWarehouseInputError(key + ' must be one non-empty string');
	return value;
}
function number(request: Request, key: string): number | undefined {
	const value = text(request, key);
	if (value === undefined) return undefined;
	if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
		throw new HubbleWarehouseInputError(key + ' must be an integer');
	return Number(value);
}
