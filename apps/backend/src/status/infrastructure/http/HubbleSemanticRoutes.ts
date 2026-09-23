import { registerHubbleAccountBalanceRoutes } from './HubbleAccountBalanceRoutes.js';
import { registerHubbleTransactionRoutes } from './HubbleTransactionRoutes.js';
import type { Router } from 'express';
import type {
	HubbleFilter,
	HubbleWarehouse
} from './HubbleWarehouseContracts.js';
import {
	HubbleSemanticNotFoundError,
	requireSupportedHolderQuery,
	transferFilters,
	appendOptionalHashFilter,
	assetFilters,
	querySemanticPage,
	appendLedgerFilters,
	semanticPage,
	parseAsset,
	requireTransactionHash,
	requireStellarAddress,
	requireContractAddress,
	requireRowIdentifier,
	requirePathInteger,
	requirePositiveIdentifier,
	optionalQueryBoolean,
	optionalQueryString,
	parseQueryInteger,
	semanticSend
} from './HubbleSemanticRouteHelpers.js';

const semanticMaximumRows = 200;

export function registerHubbleSemanticRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	registerHubbleTransactionRoutes(router, warehouse);
	registerHubbleAccountBalanceRoutes(router, warehouse);
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
							},
							{
								field: 'ledger_sequence',
								operator: 'eq',
								value: ledgerSequence
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
							},
							{
								field: 'ledger_sequence',
								operator: 'eq',
								value: ledgerSequence
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
							},
							{
								field: 'ledger_sequence',
								operator: 'eq',
								value: ledgerSequence
							}
						],
						limit: semanticMaximumRows,
						orderBy: [{ direction: 'asc', field: '_row_number' }]
					})
				]);
			return {
				contractEvents: await warehouse.classifyEventRows(contractEvents.rows),
				ledger: ledger.rows[0] ?? null,
				operations: operations.rows,
				tokenTransfers: tokenTransfers.rows,
				transaction
			};
		});
	});

	router.get('/ledgers/:sequence', async (request, response) => {
		await semanticSend(response, async () => {
			const sequence = requirePathInteger(
				request.params.sequence,
				'ledger sequence'
			);
			const result = await warehouse.query({
				dataset: 'history_ledgers',
				filters: [{ field: 'sequence', operator: 'eq', value: sequence }],
				limit: 1
			});
			const ledger = result.rows[0];
			if (ledger === undefined) {
				throw new HubbleSemanticNotFoundError(
					'Ledger was not found in the ingested range'
				);
			}
			return { ledger };
		});
	});

	router.get('/ledgers/:sequence/transactions', async (request, response) => {
		await semanticSend(response, async () =>
			querySemanticPage(
				warehouse,
				request,
				'history_transactions',
				[
					{
						field: 'ledger_sequence',
						operator: 'eq',
						value: requirePathInteger(
							request.params.sequence,
							'ledger sequence'
						)
					}
				],
				[{ direction: 'asc', field: 'id' }]
			)
		);
	});

	router.get('/operations/:operationId', async (request, response) => {
		await semanticSend(response, async () => {
			const operationId = requirePositiveIdentifier(
				request.params.operationId,
				'operation id'
			);
			const operationResult = await warehouse.query({
				dataset: 'history_operations',
				filters: [{ field: 'id', operator: 'eq', value: operationId }],
				limit: 1
			});
			const operation = operationResult.rows[0];
			if (operation === undefined) {
				throw new HubbleSemanticNotFoundError(
					'Operation was not found in the ingested range'
				);
			}
			const transactionId = requireRowIdentifier(
				operation.transaction_id,
				'transaction id'
			);
			const ledgerSequence = requireRowIdentifier(
				operation.ledger_sequence,
				'ledger sequence'
			);
			const [effects, transaction] = await Promise.all([
				warehouse.query({
					dataset: 'history_effects',
					filters: [
						{ field: 'operation_id', operator: 'eq', value: operationId },
						{ field: 'ledger_sequence', operator: 'eq', value: ledgerSequence }
					],
					limit: semanticMaximumRows,
					orderBy: [{ direction: 'asc', field: 'index' }]
				}),
				warehouse.query({
					dataset: 'history_transactions',
					filters: [
						{ field: 'id', operator: 'eq', value: transactionId },
						{ field: 'ledger_sequence', operator: 'eq', value: ledgerSequence }
					],
					limit: 1
				})
			]);
			return {
				effects: effects.rows,
				operation,
				transaction: transaction.rows[0] ?? null
			};
		});
	});

	router.get('/operations/:operationId/effects', async (request, response) => {
		await semanticSend(response, async () =>
			querySemanticPage(
				warehouse,
				request,
				'history_effects',
				[
					{
						field: 'operation_id',
						operator: 'eq',
						value: requirePositiveIdentifier(
							request.params.operationId,
							'operation id'
						)
					}
				],
				[
					{ direction: 'asc', field: 'ledger_sequence' },
					{ direction: 'asc', field: 'index' }
				]
			)
		);
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

	router.get('/accounts/:account/effects', async (request, response) => {
		await semanticSend(response, async () => {
			const filters: HubbleFilter[] = [
				{
					field: 'address',
					operator: 'eq',
					value: requireStellarAddress(request.params.account, 'account')
				}
			];
			appendLedgerFilters(request, filters);
			return querySemanticPage(warehouse, request, 'history_effects', filters, [
				{ direction: 'desc', field: 'ledger_sequence' },
				{ direction: 'desc', field: 'index' }
			]);
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

	router.get('/trades', async (request, response) => {
		await semanticSend(response, async () => {
			const filters: HubbleFilter[] = [];
			for (const [queryName, field] of [
				['seller', 'selling_account_address'],
				['buyer', 'buying_account_address'],
				['selling_asset_code', 'selling_asset_code'],
				['selling_asset_issuer', 'selling_asset_issuer'],
				['buying_asset_code', 'buying_asset_code'],
				['buying_asset_issuer', 'buying_asset_issuer'],
				['liquidity_pool_id', 'selling_liquidity_pool_id_strkey']
			] as const) {
				const value = optionalQueryString(request, queryName);
				if (value !== undefined) {
					filters.push({ field, operator: 'eq', value });
				}
			}
			appendLedgerFilters(request, filters, '_ledger_sequence');
			return querySemanticPage(warehouse, request, 'history_trades', filters, [
				{ direction: 'desc', field: '_ledger_sequence' },
				{ direction: 'desc', field: 'history_operation_id' },
				{ direction: 'desc', field: 'order' }
			]);
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
			const page = semanticPage(result, limit, offset);
			return {
				...page,
				rows: await warehouse.classifyEventRows(result.rows.slice(0, limit))
			};
		});
	});

	router.get('/contracts/:contractId/state', async (request, response) => {
		await semanticSend(response, async () => {
			const filters: HubbleFilter[] = [
				{
					field: 'contract_id',
					operator: 'eq',
					value: requireContractAddress(request.params.contractId)
				}
			];
			const ledgerKeyHash = optionalQueryString(request, 'ledger_key_hash');
			if (ledgerKeyHash !== undefined) {
				filters.push({
					field: 'ledger_key_hash',
					operator: 'eq',
					value: ledgerKeyHash
				});
			}
			const durability = optionalQueryString(request, 'durability');
			if (durability !== undefined) {
				filters.push({
					field: 'contract_durability',
					operator: 'eq',
					value: durability
				});
			}
			const deleted = optionalQueryBoolean(request, 'deleted');
			if (deleted !== undefined) {
				filters.push({ field: 'deleted', operator: 'eq', value: deleted });
			}
			appendLedgerFilters(request, filters);
			return querySemanticPage(warehouse, request, 'contract_data', filters, [
				{ direction: 'desc', field: 'ledger_sequence' },
				{ direction: 'desc', field: '_row_number' }
			]);
		});
	});

	router.get('/assets/:asset/transfers', async (request, response) => {
		await semanticSend(response, async () => {
			const filters = assetFilters(parseAsset(request.params.asset));
			for (const field of ['from', 'to'] as const) {
				const value = optionalQueryString(request, field);
				if (value !== undefined) {
					filters.push({ field, operator: 'eq', value });
				}
			}
			appendOptionalHashFilter(request, filters);
			appendLedgerFilters(request, filters);
			return querySemanticPage(warehouse, request, 'token_transfers', filters, [
				{ direction: 'desc', field: 'ledger_sequence' },
				{ direction: 'desc', field: '_row_number' }
			]);
		});
	});

	router.get('/assets/:asset/holders', async (request, response) => {
		await semanticSend(response, async () => {
			requireSupportedHolderQuery(request, ['after', 'limit']);
			return warehouse.assetHolders({
				after: optionalQueryString(request, 'after'),
				asset: parseAsset(request.params.asset),
				limit: parseQueryInteger(request, 'limit', 100, 1, 200)
			});
		});
	});

	router.get('/assets/:asset/holders/:account', async (request, response) => {
		await semanticSend(response, async () => {
			requireSupportedHolderQuery(request, []);
			const account = requireStellarAddress(request.params.account, 'account');
			const page = await warehouse.assetHolders({
				account,
				asset: parseAsset(request.params.asset),
				limit: 1
			});
			if (page.holders.length === 0) {
				throw new HubbleSemanticNotFoundError(
					'No positive balance in the latest ingested state for this account/asset; this does not establish absence on the current chain',
					{
						asset: page.asset,
						coverage: page.coverage,
						watermark: page.watermark
					}
				);
			}
			return {
				asset: page.asset,
				holder: page.holders[0],
				coverage: page.coverage,
				watermark: page.watermark
			};
		});
	});
}
