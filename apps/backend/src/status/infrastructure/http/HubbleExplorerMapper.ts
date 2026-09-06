import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

export type ExplorerEntity =
	'operations' | 'assets' | 'contracts' | 'trades' | 'offers';
type Row = Readonly<Record<string, unknown>>;

export function explorerAsset(row: Row, prefix = ''): Record<string, unknown> {
	const type = text(row, prefix + 'asset_type');
	const code = text(row, prefix + 'asset_code');
	const issuer = text(row, prefix + 'asset_issuer');
	return {
		id: type === 'native' ? 'native' : code + ':' + issuer,
		type,
		code: code || null,
		issuer: issuer || null
	};
}

export function mapExplorerRecord(
	entity: ExplorerEntity,
	row: Row
): Record<string, unknown> {
	if (entity === 'assets') return explorerAsset(row);
	if (entity === 'contracts') return { id: text(row, 'contract_id') };
	const ledgerSequence = integer(row, '_ledger_sequence');
	const sourceRecord = {
		batchId: text(row, '_batch_id'),
		digest: text(row, '_source_sha256'),
		rowNumber: exact(row, '_row_number')
	};
	const closedAt = date(
		row,
		entity === 'trades' ? 'ledger_closed_at' : 'closed_at'
	);
	const shared = { ledgerSequence, closedAt, sourceRecord };
	if (entity === 'operations')
		return {
			...shared,
			id: exact(row, 'id'),
			transactionId: exact(row, 'transaction_id'),
			sourceAccount: text(row, 'source_account'),
			type: text(row, 'type_string'),
			typeCode: integer(row, 'type'),
			details: row.details_json ?? row.details ?? null
		};
	const pair = {
		sellingAsset: explorerAsset(row, 'selling_'),
		buyingAsset: explorerAsset(row, 'buying_'),
		amountPrecision: 'source_float64'
	};
	if (entity === 'offers')
		return {
			...shared,
			...pair,
			id: exact(row, 'offer_id'),
			seller: text(row, 'seller_id'),
			amount: decimal(row, 'amount'),
			price: {
				numerator: exact(row, 'pricen'),
				denominator: exact(row, 'priced')
			},
			deleted: boolean(row, 'deleted'),
			lastModifiedLedger: integer(row, 'last_modified_ledger')
		};
	const operationId = exact(row, 'history_operation_id'),
		order = integer(row, 'order');
	return {
		...shared,
		...pair,
		id: operationId + ':' + order,
		operationId,
		order,
		seller: text(row, 'selling_account_address') || null,
		buyer: text(row, 'buying_account_address') || null,
		sellingAmount: decimal(row, 'selling_amount'),
		buyingAmount: decimal(row, 'buying_amount'),
		price: {
			numerator: exact(row, 'price_n'),
			denominator: exact(row, 'price_d')
		}
	};
}
function text(row: Row, key: string): string {
	const value = row[key];
	if (typeof value !== 'string') return invalid(key);
	return value;
}
function exact(row: Row, key: string): string {
	const value = row[key];
	if (typeof value === 'string' && /^-?[0-9]+$/.test(value)) return value;
	if (typeof value === 'number' && Number.isSafeInteger(value))
		return String(value);
	return invalid(key);
}
function integer(row: Row, key: string): number {
	const value = Number(exact(row, key));
	if (!Number.isSafeInteger(value)) return invalid(key);
	return value;
}
function decimal(row: Row, key: string): string {
	const value = row[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(key);
	return String(value);
}
function boolean(row: Row, key: string): boolean {
	const value = row[key];
	if (typeof value !== 'boolean') return invalid(key);
	return value;
}
function date(row: Row, key: string): string {
	const value = text(row, key),
		parsed = new Date(
			value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
		);
	if (!Number.isFinite(parsed.getTime())) return invalid(key);
	return parsed.toISOString();
}
function invalid(key: string): never {
	throw new HubbleWarehouseUnavailableError('Invalid explorer field: ' + key);
}
