import { StrKey } from '@stellar/stellar-sdk';
import type { Request, Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import type { HubbleSemanticQueryExecutor } from './HubbleSemanticWarehouse.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import {
	parseAsset,
	optionalQueryString,
	optionalQueryInteger,
	semanticSend
} from './HubbleSemanticRouteHelpers.js';
import {
	queryAssetBalanceHistory,
	queryAssetRankings,
	type RankingSelection,
	type ReportSelection
} from './HubbleAssetReportQuery.js';

const common = new Set([
	'min_ledger',
	'max_ledger',
	'start_time',
	'end_time',
	'limit',
	'after',
	'order',
	'account'
]);
const rankNames = new Set([...common, 'metric', 'counter_asset']);
function requestValues(
	request: Request,
	allowed: ReadonlySet<string>
): Map<string, string> {
	const values = new Map<string, string>();
	for (const name of Object.keys(request.query)) {
		if (!allowed.has(name))
			throw new HubbleWarehouseInputError(
				'Unsupported asset report parameter: ' + name
			);
		const value = optionalQueryString(request, name);
		if (value === undefined)
			throw new HubbleWarehouseInputError(
				name + ' must be a single non-empty value'
			);
		values.set(name, value);
	}
	return values;
}
function validAddress(value: string, name: string): string {
	if (!StrKey.isValidEd25519PublicKey(value) && !StrKey.isValidContract(value))
		throw new HubbleWarehouseInputError(
			name + ' must be a checksum-valid G or C address'
		);
	return value;
}
function baseSelection(
	request: Request,
	allowed: ReadonlySet<string> = common
): ReportSelection & { account?: string } {
	const values = requestValues(request, allowed);
	const minLedger = optionalQueryInteger(request, 'min_ledger', 1, 4294967295);
	const maxLedger = optionalQueryInteger(request, 'max_ledger', 1, 4294967295);
	if (
		minLedger !== undefined &&
		maxLedger !== undefined &&
		minLedger > maxLedger
	)
		throw new HubbleWarehouseInputError('min_ledger cannot exceed max_ledger');
	const startTime = values.get('start_time'),
		endTime = values.get('end_time');
	for (const time of [startTime, endTime])
		if (
			time !== undefined &&
			(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(time) ||
				!Number.isFinite(Date.parse(time)))
		)
			throw new HubbleWarehouseInputError('Times must be UTC ISO timestamps');
	if (startTime && endTime && Date.parse(startTime) > Date.parse(endTime))
		throw new HubbleWarehouseInputError('start_time cannot exceed end_time');
	const limit = optionalQueryInteger(request, 'limit', 1, 200) ?? 100;
	const order = values.get('order') ?? 'desc';
	if (order !== 'asc' && order !== 'desc')
		throw new HubbleWarehouseInputError('order must be asc or desc');
	const after = values.get('after');
	if (after && after.length > 2048)
		throw new HubbleWarehouseInputError('after cursor is too long');
	const account = values.get('account');
	return {
		asset: parseAsset(request.params.asset!),
		...(minLedger === undefined ? {} : { minLedger }),
		...(maxLedger === undefined ? {} : { maxLedger }),
		...(startTime ? { startTime } : {}),
		...(endTime ? { endTime } : {}),
		limit,
		...(after ? { after } : {}),
		order,
		...(account ? { account: validAddress(account, 'account') } : {})
	};
}
export function registerHubbleAssetReportRoutes(
	router: Router,
	_warehouse: HubbleWarehouse,
	executorProvider: () => HubbleSemanticQueryExecutor
): void {
	router.get('/assets/:asset/rankings', async (request, response) => {
		await semanticSend(response, async () => {
			const values = requestValues(request, rankNames);
			const base = baseSelection(request, rankNames);
			const metric = values.get('metric') ?? 'volume';
			if (!['bought', 'sold', 'volume', 'transactions'].includes(metric))
				throw new HubbleWarehouseInputError(
					'metric must be bought, sold, volume, or transactions'
				);
			const counter = values.get('counter_asset');
			const input: RankingSelection = {
				...base,
				metric: metric as RankingSelection['metric'],
				...(counter ? { counterAsset: parseAsset(counter) } : {})
			};
			return queryAssetRankings(executorProvider(), input);
		});
	});
	router.get('/assets/:asset/balance-history', async (request, response) => {
		await semanticSend(response, async () => {
			const input = baseSelection(request);
			return queryAssetBalanceHistory(executorProvider(), input, input.account);
		});
	});
}
