import type { Request, Response, Router } from 'express';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError,
	type HubbleFilter,
	type HubbleQuery,
	type HubbleQueryResult,
	type HubbleWarehouse
} from './HubbleWarehouseClient.js';
import type {
	HubbleAssetReference,
	HubbleNativeAssetReference
} from './HubbleSemanticWarehouse.js';

const transactionHashPattern = /^[0-9a-fA-F]{64}$/;
const stellarAddressPattern = /^[GMC][A-Z2-7]{55,68}$/;
const contractAddressPattern = /^C[A-Z2-7]{55}$/;
const assetCodePattern = /^[A-Za-z0-9]{1,12}$/;
const semanticMaximumRows = 200;

class HubbleSemanticNotFoundError extends Error {}

export function registerHubbleSemanticRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	router.get('/transactions/:transactionHash', async (request, response) => {
		await semanticSend(response, async () => {
			const transactionHash = requireTransactionHash(
				request.params.transactionHash
			);
			const transactionResult = await warehouse.query({
				dataset: 'history_transactions',
				filters: [
					{
						field: 'transaction_hash',
						operator: 'eq',
						value: transactionHash
					}
				],
				limit: 1
			});
			const transaction = transactionResult.rows[0];
			if (transaction === undefined) {
				throw new HubbleSemanticNotFoundError(
					'Transaction was not found in the ingested ledger range'
				);
			}
			const transactionId = requireRowIdentifier(
				transaction.id,
				'transaction id'
			);
			const ledgerSequence = requireRowIdentifier(
				transaction.ledger_sequence,
				'ledger sequence'
			);
			const [ledger, operations, contractEvents, tokenTransfers] =
				await Promise.all([
					warehouse.query({
						dataset: 'history_ledgers',
						filters: [
							{ field: 'sequence', operator: 'eq', value: ledgerSequence }
						],
						limit: 1
					}),
					warehouse.query({
						dataset: 'history_operations',
						filters: [
							{
								field: 'transaction_id',
								operator: 'eq',
								value: transactionId
							}
						],
						limit: semanticMaximumRows,
						orderBy: [{ direction: 'asc', field: 'id' }]
					}),
					warehouse.query({
						dataset: 'history_contract_events',
						filters: [
							{
								field: 'transaction_hash',
								operator: 'eq',
								value: transactionHash
							}
						],
						limit: semanticMaximumRows,
						orderBy: [{ direction: 'asc', field: '_row_number' }]
					}),
					warehouse.query({
						dataset: 'token_transfers',
						filters: [
							{
								field: 'transaction_hash',
								operator: 'eq',
								value: transactionHash
							}
						],
						limit: semanticMaximumRows,
						orderBy: [{ direction: 'asc', field: '_row_number' }]
					})
				]);
			return {
				contractEvents: contractEvents.rows,
				ledger: ledger.rows[0] ?? null,
				operations: operations.rows,
				tokenTransfers: tokenTransfers.rows,
				transaction
			};
		});
	});

	router.get('/accounts/:account/transactions', async (request, response) => {
		await semanticSend(response, async () => {
			const account = requireStellarAddress(request.params.account, 'account');
			return warehouse.accountTransactions({
				account,
				limit: parseQueryInteger(request, 'limit', 100, 1, 200),
				offset: parseQueryInteger(
					request,
					'offset',
					0,
					0,
					Number.MAX_SAFE_INTEGER
				)
			});
		});
	});

	router.get('/transfers', async (request, response) => {
		await semanticSend(response, async () => {
			const limit = parseQueryInteger(request, 'limit', 100, 1, 200);
			const offset = parseQueryInteger(
				request,
				'offset',
				0,
				0,
				Number.MAX_SAFE_INTEGER
			);
			const filters = transferFilters(request);
			const result = await warehouse.query({
				dataset: 'token_transfers',
				filters,
				limit: limit + 1,
				offset,
				orderBy: [
					{ direction: 'desc', field: 'ledger_sequence' },
					{ direction: 'desc', field: '_row_number' }
				]
			});
			return semanticPage(result, limit, offset);
		});
	});

	router.get('/contracts/:contractId/events', async (request, response) => {
		await semanticSend(response, async () => {
			const contractId = requireContractAddress(request.params.contractId);
			const limit = parseQueryInteger(request, 'limit', 100, 1, 200);
			const offset = parseQueryInteger(
				request,
				'offset',
				0,
				0,
				Number.MAX_SAFE_INTEGER
			);
			const filters: HubbleFilter[] = [
				{ field: 'contract_id', operator: 'eq', value: contractId }
			];
			appendOptionalHashFilter(request, filters);
			appendLedgerFilters(request, filters);
			const result = await warehouse.query({
				dataset: 'history_contract_events',
				filters,
				limit: limit + 1,
				offset,
				orderBy: [
					{ direction: 'desc', field: 'ledger_sequence' },
					{ direction: 'desc', field: '_row_number' }
				]
			});
			return semanticPage(result, limit, offset);
		});
	});

	router.get('/assets/:asset/holders', async (request, response) => {
		await semanticSend(response, async () =>
			warehouse.assetHolders({
				after: optionalQueryString(request, 'after'),
				asset: parseAsset(request.params.asset),
				limit: parseQueryInteger(request, 'limit', 100, 1, 200)
			})
		);
	});

	router.get('/assets/:asset/holders/:account', async (request, response) => {
		await semanticSend(response, async () => {
			const account = requireStellarAddress(request.params.account, 'account');
			const page = await warehouse.assetHolders({
				account,
				asset: parseAsset(request.params.asset),
				limit: 1
			});
			if (page.holders.length === 0) {
				throw new HubbleSemanticNotFoundError(
					'The account does not currently hold this asset in the ingested range'
				);
			}
			return {
				asset: page.asset,
				holder: page.holders[0]
			};
		});
	});
}

function transferFilters(request: Request): HubbleFilter[] {
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

function appendOptionalHashFilter(
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

function appendLedgerFilters(request: Request, filters: HubbleFilter[]): void {
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
			field: 'ledger_sequence',
			operator: 'gte',
			value: minimumLedger
		});
	}
	if (maximumLedger !== undefined) {
		filters.push({
			field: 'ledger_sequence',
			operator: 'lte',
			value: maximumLedger
		});
	}
}

function semanticPage(
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

function parseAsset(
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

function requireTransactionHash(value: string): string {
	if (!transactionHashPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			'transaction hash must be 64 hexadecimal characters'
		);
	}
	return value.toLowerCase();
}

function requireStellarAddress(value: string, name: string): string {
	if (!stellarAddressPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			name + ' is not a valid Stellar address'
		);
	}
	return value;
}

function requireContractAddress(value: string): string {
	if (!contractAddressPattern.test(value)) {
		throw new HubbleWarehouseInputError(
			'contract id is not a valid Stellar contract address'
		);
	}
	return value;
}

function requireRowIdentifier(value: unknown, name: string): string {
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

function optionalQueryString(
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

function parseQueryInteger(
	request: Request,
	name: string,
	defaultValue: number,
	minimum: number,
	maximum: number
): number {
	return optionalQueryInteger(request, name, minimum, maximum) ?? defaultValue;
}

function optionalQueryInteger(
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

async function semanticSend(
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
				error: error.message
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
