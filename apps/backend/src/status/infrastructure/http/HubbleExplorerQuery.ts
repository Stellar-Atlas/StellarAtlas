import { attachExplorerTransactionHashes } from './HubbleExplorerRelationships.js';
import { isHubbleLedgerWindowComplete } from './HubbleLedgerCoverage.js';
import type {
	HubbleFilter,
	HubbleQuery,
	HubbleWarehouse
} from './HubbleWarehouseContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import {
	normalizeHubbleTransferInput,
	normalizeTransferAsset,
	validateTransferLedgerRange
} from './HubbleTransferValidation.js';
import {
	mapExplorerRecord,
	type ExplorerEntity
} from './HubbleExplorerMapper.js';

export interface ExplorerInput {
	readonly entity: ExplorerEntity;
	readonly id?: string;
	readonly minLedger?: number;
	readonly maxLedger?: number;
	readonly limit?: number;
	readonly offset?: number;
	readonly filters: Readonly<Record<string, string>>;
	readonly startTime?: string;
	readonly endTime?: string;
}
const datasets: Record<ExplorerEntity, string> = {
	operations: 'history_operations',
	assets: 'history_assets',
	contracts: 'contract_data',
	trades: 'history_trades',
	offers: 'offers'
};
export function operationLedger(id: string): number {
	if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
		fail('Invalid operation id');
	const ledger = Number(BigInt(id) >> 32n);
	if (ledger < 1) fail('Operation id does not encode a ledger');
	return ledger;
}
export async function queryExplorer(
	warehouse: HubbleWarehouse,
	input: ExplorerInput
): Promise<Record<string, unknown>> {
	const catalog = await warehouse.catalog();
	const operationId =
		input.entity === 'operations'
			? input.id
			: input.entity === 'trades'
				? input.id?.split(':')[0]
				: undefined;
	const encodedLedger =
		operationId === undefined ? undefined : operationLedger(operationId);
	const maxLedger =
		input.maxLedger ??
		encodedLedger ??
		Number(catalog.coverage.maximumLedger ?? 2);
	const minLedger =
		input.minLedger ?? encodedLedger ?? Math.max(2, maxLedger - 63);
	const normalized = normalizeHubbleTransferInput({
		minLedger,
		maxLedger,
		startTime: input.startTime,
		endTime: input.endTime
	});
	validateTransferLedgerRange(minLedger, maxLedger);
	if (
		encodedLedger !== undefined &&
		(encodedLedger < minLedger || encodedLedger > maxLedger)
	)
		fail('Operation ledger is outside the selected window');
	const limit = input.limit ?? 25,
		offset = input.offset ?? 0;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
		fail('limit must be between 1 and 100');
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
		fail('offset must be between 0 and 10000');
	const filters: HubbleFilter[] = [
		{ field: '_ledger_sequence', operator: 'gte', value: minLedger },
		{ field: '_ledger_sequence', operator: 'lte', value: maxLedger }
	];
	const timeField =
		input.entity === 'trades' ? 'ledger_closed_at' : 'closed_at';
	if (normalized.startTime)
		filters.push({
			field: timeField,
			operator: 'gte',
			value: normalized.startTime.replace('T', ' ').replace('Z', '')
		});
	if (normalized.endTime)
		filters.push({
			field: timeField,
			operator: 'lt',
			value: normalized.endTime.replace('T', ' ').replace('Z', '')
		});
	addFilters(input, filters);
	const distinct = input.entity === 'assets' || input.entity === 'contracts';
	const select =
		input.entity === 'assets'
			? ['asset_type', 'asset_code', 'asset_issuer']
			: input.entity === 'contracts'
				? ['contract_id']
				: undefined;
	const orderBy: HubbleQuery['orderBy'] = distinct
		? select!.map((field) => ({ field, direction: 'asc' }))
		: [
				{ field: '_ledger_sequence', direction: 'desc' },
				{ field: '_row_number', direction: 'desc' },
				{ field: '_batch_id', direction: 'asc' }
			];
	let result = await warehouse.query({
		dataset: datasets[input.entity],
		distinct,
		filters,
		select,
		orderBy,
		limit: input.id ? 1 : limit + 1,
		offset: input.id ? 0 : offset
	});
	// State entries are emitted at a batch boundary; invocation events may precede it.
	// The same bounded window can therefore prove the contract was observed without
	// claiming a state snapshot exists at the invocation ledger.
	if (
		input.entity === 'contracts' &&
		input.id !== undefined &&
		result.rows.length === 0
	) {
		result = await warehouse.query({
			dataset: 'history_contract_events',
			distinct: true,
			filters,
			select: ['contract_id'],
			orderBy: [{ field: 'contract_id', direction: 'asc' }],
			limit: 1
		});
	}
	const coverage = catalog.coverage;
	const complete = isHubbleLedgerWindowComplete(coverage, minLedger, maxLedger);
	const metadata = {
		entity: input.entity,
		window: { minLedger, maxLedger },
		coverage,
		coverageStatus: complete ? 'complete' : 'partial_or_unknown',
		source: 'stellar_hubble',
		semantics:
			input.entity === 'offers'
				? 'Historical offer changes; detail is latest observed in the selected window, not the current order book.'
				: distinct
					? 'Distinct identities observed in completed parsed batches within the selected window, not a current global registry.'
					: 'Records from completed parsed batches within the selected ledger and optional time window.'
	};
	let records = result.rows
		.slice(0, input.id ? 1 : limit)
		.map((row) => mapExplorerRecord(input.entity, row));
	if (input.entity === 'operations')
		records = [...(await attachExplorerTransactionHashes(warehouse, records))];
	if (input.id !== undefined)
		return {
			...metadata,
			record: records[0] ?? null
		};
	const hasMore = result.rows.length > limit;
	return {
		...metadata,
		rows: records,
		limit,
		offset,
		nextOffset: hasMore ? offset + limit : null
	};
}
function addFilters(input: ExplorerInput, filters: HubbleFilter[]): void {
	const eq = (field: string, value: string) =>
		filters.push({ field, operator: 'eq', value });
	const maps: Record<ExplorerEntity, Readonly<Record<string, string>>> = {
		operations: { source_account: 'source_account', type: 'type' },
		assets: { asset_code: 'asset_code', asset_issuer: 'asset_issuer' },
		contracts: {},
		offers: { seller: 'seller_id', offer_id: 'offer_id' },
		trades: {
			seller: 'selling_account_address',
			buyer: 'buying_account_address',
			operation_id: 'history_operation_id'
		}
	};
	for (const [name, value] of Object.entries(input.filters)) {
		if (
			input.entity === 'operations' &&
			name === 'type' &&
			!/^[0-9]+$/.test(value)
		) {
			if (!/^[a-z][a-z0-9_]{1,63}$/.test(value)) fail('Invalid operation type');
			eq('type_string', value);
			continue;
		}
		const field = maps[input.entity][name];
		if (field !== undefined) {
			if (
				['source_account', 'seller', 'buyer', 'asset_issuer'].includes(name) &&
				!/^G[A-Z2-7]{55}$/.test(value)
			)
				fail('Invalid ' + name);
			if (
				['type', 'offer_id', 'operation_id'].includes(name) &&
				!/^[0-9]+$/.test(value)
			)
				fail('Invalid ' + name);
			if (name === 'asset_code' && !/^[a-zA-Z0-9]{1,12}$/.test(value))
				fail('Invalid asset_code');
			eq(field, value);
			continue;
		}
		if (
			(input.entity === 'offers' || input.entity === 'trades') &&
			['selling_asset', 'buying_asset'].includes(name)
		) {
			assetFilters(value, name.replace('asset', ''), eq);
			continue;
		}
		fail('Unsupported ' + input.entity + ' filter: ' + name);
	}
	if (input.id === undefined) return;
	if (input.entity === 'operations') eq('id', input.id);
	if (input.entity === 'offers') {
		if (!/^[1-9][0-9]{0,18}$/.test(input.id)) fail('Invalid offer id');
		eq('offer_id', input.id);
	}
	if (input.entity === 'assets') assetFilters(input.id, '', eq);
	if (input.entity === 'contracts') {
		if (!/^C[A-Z2-7]{55}$/.test(input.id)) fail('Invalid contract id');
		eq('contract_id', input.id);
	}
	if (input.entity === 'trades') {
		const match = /^([1-9][0-9]{0,18}):([0-9]{1,10})$/.exec(input.id);
		if (!match || Number(match[2]) > 2147483647)
			fail('Trade id must be OPERATION_ID:ORDER');
		eq('history_operation_id', match[1]!);
		eq('order', match[2]!);
	}
}
function assetFilters(
	value: string,
	prefix: string,
	eq: (field: string, value: string) => void
): void {
	const asset = normalizeTransferAsset(value);
	if (asset === 'native') {
		eq(prefix + 'asset_type', 'native');
		return;
	}
	const [code, issuer] = asset.split(':');
	eq(prefix + 'asset_code', code!);
	eq(prefix + 'asset_issuer', issuer!);
}
function fail(message: string): never {
	throw new HubbleWarehouseInputError(message);
}
