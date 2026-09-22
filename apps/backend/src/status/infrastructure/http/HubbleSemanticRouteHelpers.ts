import type { Request, Response } from 'express';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import type {
	HubbleFilter,
	HubbleQuery,
	HubbleQueryResult,
	HubbleWarehouse
} from './HubbleWarehouseContracts.js';
import type {
	HubbleAssetReference,
	HubbleNativeAssetReference,
	HubbleAssetHolderEvidence
} from './HubbleSemanticWarehouse.js';

const transactionHashPattern = /^[0-9a-fA-F]{64}$/;
const stellarAddressPattern = /^[GMC][A-Z2-7]{55,68}$/;
const contractAddressPattern = /^C[A-Z2-7]{55}$/;
const assetCodePattern = /^[A-Za-z0-9]{1,12}$/;

export class HubbleSemanticNotFoundError extends Error {
	constructor(
		message: string,
		readonly context?: HubbleAssetHolderEvidence & { readonly asset: string }
	) {
		super(message);
	}
}

export function requireSupportedHolderQuery(
	request: Request,
	names: readonly string[]
): void {
	for (const name of Object.keys(request.query))
		if (!names.includes(name))
			throw new HubbleWarehouseInputError(
				'Unsupported holder parameter: ' +
					name +
					'; historical as-of state is not supported'
			);
}

export function transferFilters(request: Request): HubbleFilter[] {
	const filters: HubbleFilter[] = [];
	for (const [queryName, field] of [
		['from', 'from'],
		['to', 'to'],
		['asset', 'asset'],
		['asset_code', 'asset_code'],
		['asset_issuer', 'asset_issuer'],
		['contract_id', 'contract_id']
	] as const) {
		const value = optionalQueryString(request, queryName);
		if (value !== undefined) {
			filters.push({ field, operator: 'eq', value });
		}
	}
	appendOptionalHashFilter(request, filters);
	appendLedgerFilters(request, filters);
	return filters;
}

export function appendOptionalHashFilter(
	request: Request,
	filters: HubbleFilter[]
): void {
	const transactionHash = optionalQueryString(request, 'transaction_hash');
	if (transactionHash !== undefined) {
		filters.push({
			field: 'transaction_hash',
			operator: 'eq',
			value: requireTransactionHash(transactionHash)
		});
	}
}

export function assetFilters(
	asset: HubbleAssetReference | HubbleNativeAssetReference
): HubbleFilter[] {
	if (asset.type === 'native') {
		return [{ field: 'asset_type', operator: 'eq', value: 'native' }];
	}
	return [
		{ field: 'asset_code', operator: 'eq', value: asset.code },
		{ field: 'asset_issuer', operator: 'eq', value: asset.issuer }
	];
}

export async function querySemanticPage(
	warehouse: HubbleWarehouse,
	request: Request,
	dataset: string,
	filters: readonly HubbleFilter[],
	orderBy: HubbleQuery['orderBy']
): Promise<Record<string, unknown>> {
	const limit = parseQueryInteger(request, 'limit', 100, 1, 200);
	const offset = parseQueryInteger(
		request,
		'offset',
		0,
		0,
		Number.MAX_SAFE_INTEGER
	);
	const result = await warehouse.query({
		dataset,
		filters,
		limit: limit + 1,
		offset,
		orderBy
	});
	return semanticPage(result, limit, offset);
}

export function appendLedgerFilters(
	request: Request,
	filters: HubbleFilter[],
	field = 'ledger_sequence'
): void {
	const minimumLedger = optionalQueryInteger(request, 'min_ledger', 1);
	const maximumLedger = optionalQueryInteger(request, 'max_ledger', 1);
	if (
		minimumLedger !== undefined &&
		maximumLedger !== undefined &&
		minimumLedger > maximumLedger
	) {
		throw new HubbleWarehouseInputError(
			'min_ledger cannot be greater than max_ledger'
		);
	}
	if (minimumLedger !== undefined) {
		filters.push({
			field,
			operator: 'gte',
			value: minimumLedger
		});
	}
	if (maximumLedger !== undefined) {
		filters.push({
			field,
			operator: 'lte',
			value: maximumLedger
		});
	}
}

export function semanticPage(
	result: HubbleQueryResult,
	limit: number,
	offset: number
): Record<string, unknown> {
	const hasMore = result.rows.length > limit;
	return {
		columns: result.columns,
		dataset: result.dataset,
		elapsedMilliseconds: result.elapsedMilliseconds,
		limit,
		nextOffset: hasMore ? offset + limit : null,
		offset,
		rows: hasMore ? result.rows.slice(0, limit) : result.rows
	};
}

export function parseAsset(
	value: string
): HubbleAssetReference | HubbleNativeAssetReference {
	if (value.toLowerCase() === 'native') return { type: 'native' };
	const separator = value.lastIndexOf(':');
	if (separator < 1) {
		throw new HubbleWarehouseInputError('Asset must be native or CODE:ISSUER');
	}
	const code = value.slice(0, separator);
	const issuer = value.slice(separator + 1);
	if (!assetCodePattern.test(code)) {
		throw new HubbleWarehouseInputError(
			'Asset code must contain 1 to 12 letters or digits'
		);
	}
	return {
		code,
		issuer: requireStellarAddress(issuer, 'asset issuer'),
		type: 'issued'
	};
}

export function requireTransactionHash(value: string): string {
	if (!transactionHashPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			'transaction hash must be 64 hexadecimal characters'
		);
	}
	return value.toLowerCase();
}

export function requireStellarAddress(value: string, name: string): string {
	if (!stellarAddressPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			name + ' is not a valid Stellar address'
		);
	}
	return value;
}

export function requireContractAddress(value: string): string {
	if (!contractAddressPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			'contract id is not a valid Stellar contract address'
		);
	}
	return value;
}

export function requireRowIdentifier(value: unknown, name: string): string {
	if (
		(typeof value !== 'string' && typeof value !== 'number') ||
		String(value) === ''
	) {
		throw new HubbleWarehouseUnavailableError(
			'Hubble returned an invalid ' + name
		);
	}
	return String(value);
}

export function requirePathInteger(value: string, name: string): number {
	const parsed = Number(value);
	if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
		throw new HubbleWarehouseInputError(name + ' must be a positive integer');
	}
	return parsed;
}

export function requirePositiveIdentifier(value: string, name: string): string {
	if (!/^[0-9]{1,20}$/.test(value) || BigInt(value) < 1n) {
		throw new HubbleWarehouseInputError(name + ' must be a positive integer');
	}
	return value;
}

export function optionalQueryBoolean(
	request: Request,
	name: string
): boolean | undefined {
	const raw = optionalQueryString(request, name);
	if (raw === undefined) return undefined;
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	throw new HubbleWarehouseInputError(name + ' must be true or false');
}

export function optionalQueryString(
	request: Request,
	name: string
): string | undefined {
	const value = request.query[name];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value === '') {
		throw new HubbleWarehouseInputError(name + ' must be one non-empty value');
	}
	return value;
}

export function parseQueryInteger(
	request: Request,
	name: string,
	defaultValue: number,
	minimum: number,
	maximum: number
): number {
	return optionalQueryInteger(request, name, minimum, maximum) ?? defaultValue;
}

export function optionalQueryInteger(
	request: Request,
	name: string,
	minimum: number,
	maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
	const raw = optionalQueryString(request, name);
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new HubbleWarehouseInputError(
			name + ' must be an integer between ' + minimum + ' and ' + maximum
		);
	}
	return value;
}

export async function semanticSend(
	response: Response,
	action: () => Promise<unknown>
): Promise<void> {
	try {
		response.setHeader('Cache-Control', 'no-store');
		response.status(200).json(await action());
	} catch (error) {
		if (error instanceof HubbleSemanticNotFoundError) {
			response.status(404).json({
				code: 'hubble_record_not_found',
				error: error.message,
				...error.context
			});
			return;
		}
		if (error instanceof HubbleWarehouseInputError) {
			response.status(400).json({
				code: 'invalid_hubble_query',
				error: error.message
			});
			return;
		}
		if (error instanceof HubbleWarehouseUnavailableError) {
			console.error('Hubble semantic query failed', error);
			response.status(503).json({
				code: 'hubble_warehouse_unavailable',
				error: 'The Hubble warehouse is temporarily unavailable'
			});
			return;
		}
		console.error('Unexpected Hubble semantic API failure', error);
		response.status(500).json({
			code: 'hubble_query_failed',
			error: 'The Hubble query could not be completed'
		});
	}
}
