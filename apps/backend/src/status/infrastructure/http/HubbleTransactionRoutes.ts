import type { Request, Router } from 'express';
import type { HubbleTransactionInput } from './HubbleTransactionContracts.js';
import { normalizeTransactionInput } from './HubbleTransactionCursor.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';

/** The default legacy response remains unchanged; typed is an explicit representation. */
export function registerHubbleTransactionRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	router.get(
		'/transactions/:transactionHash',
		async (request, response, next) => {
			if (request.query.view === undefined) {
				next();
				return;
			}
			response.setHeader('Cache-Control', 'no-store');
			try {
				const detail = await warehouse.transactionDetail(parseRequest(request));
				if (detail === null) {
					response.status(404).json({
						code: 'hubble_not_found',
						error: 'Transaction was not found in the ingested ledger range'
					});
				} else response.status(200).json(detail);
			} catch (error) {
				if (error instanceof HubbleWarehouseInputError) {
					response
						.status(400)
						.json({ code: 'invalid_hubble_query', error: error.message });
				} else {
					console.error('Hubble transaction detail failed', error);
					response
						.status(
							error instanceof HubbleWarehouseUnavailableError ? 503 : 500
						)
						.json({
							code:
								error instanceof HubbleWarehouseUnavailableError
									? 'hubble_warehouse_unavailable'
									: 'hubble_query_failed',
							error:
								'The transaction query could not be completed; supply the ledger hint when known or try again'
						});
				}
			}
		}
	);
}
export function parseTransactionRequestValues(
	query: Record<string, unknown>,
	transactionHash: string
): HubbleTransactionInput {
	const names: Readonly<Record<string, string>> = {
		ledger_sequence: 'ledgerSequence',
		limit: 'limit',
		operations_after: 'operationsAfter',
		effects_after: 'effectsAfter',
		events_after: 'eventsAfter'
	};
	if (query.view !== 'typed')
		throw new HubbleWarehouseInputError('view must be typed when supplied');
	const input: Record<string, string | number> = { transactionHash };
	for (const [name, value] of Object.entries(query)) {
		if (name === 'view') continue;
		const field = names[name];
		if (!field)
			throw new HubbleWarehouseInputError(
				'Unknown transaction parameter: ' + name
			);
		if (typeof value !== 'string' || value === '')
			throw new HubbleWarehouseInputError(
				name + ' must be one non-empty value'
			);
		if (field === 'limit' || field === 'ledgerSequence') {
			if (!/^[0-9]+$/.test(value))
				throw new HubbleWarehouseInputError(name + ' must be an integer');
			input[field] = Number(value);
		} else input[field] = value;
	}
	return normalizeTransactionInput(input as unknown as HubbleTransactionInput);
}
function parseRequest(request: Request): HubbleTransactionInput {
	return parseTransactionRequestValues(
		request.query,
		request.params.transactionHash!
	);
}
