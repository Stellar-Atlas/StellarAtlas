import type { Request, Response, Router } from 'express';
import type { HubbleTransferInput } from './HubbleTransferContracts.js';
import { normalizeHubbleTransferInput } from './HubbleTransferValidation.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';

const queryNames: Readonly<Record<string, keyof HubbleTransferInput>> = {
	account: 'account',
	from: 'from',
	to: 'to',
	asset: 'asset',
	contract_id: 'contractId',
	transaction_hash: 'transactionHash',
	event_topic: 'eventTopic',
	start_time: 'startTime',
	end_time: 'endTime',
	min_ledger: 'minLedger',
	max_ledger: 'maxLedger',
	amount_raw: 'amountRaw',
	min_amount_raw: 'minAmountRaw',
	max_amount_raw: 'maxAmountRaw',
	limit: 'limit',
	after: 'after'
};

export function registerHubbleTransferRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	for (const path of [
		'/activity/transfers',
		'/accounts/:account/activity/transfers',
		'/assets/:asset/activity/transfers'
	])
		router.get(path, async (request, response) => {
			response.setHeader('Cache-Control', 'no-store');
			try {
				response
					.status(200)
					.json(
						await warehouse.transferActivity(parseTransferRequest(request))
					);
			} catch (error) {
				sendError(response, error);
			}
		});
}

export function scopedTransferInput(
	input: HubbleTransferInput,
	scope: { readonly account?: string; readonly asset?: string }
): HubbleTransferInput {
	for (const key of ['account', 'asset'] as const)
		if (
			scope[key] !== undefined &&
			input[key] !== undefined &&
			scope[key] !== input[key]
		)
			throw new HubbleWarehouseInputError(
				key + ' filter conflicts with the path/query scope'
			);
	return normalizeHubbleTransferInput({ ...input, ...scope });
}

function parseTransferRequest(request: Request): HubbleTransferInput {
	const input: Record<string, string | number> = {};
	for (const [name, value] of Object.entries(request.query)) {
		const field = queryNames[name];
		if (field === undefined)
			throw new HubbleWarehouseInputError(
				'Unknown transfer parameter: ' + name
			);
		if (typeof value !== 'string' || value === '')
			throw new HubbleWarehouseInputError(
				name + ' must be one non-empty value'
			);
		if (field === 'limit' || field === 'minLedger' || field === 'maxLedger') {
			if (!/^[0-9]+$/.test(value))
				throw new HubbleWarehouseInputError(name + ' must be an integer');
			input[field] = Number(value);
		} else input[field] = value;
	}
	const scope: { account?: string; asset?: string } = {};
	if (request.params.account !== undefined)
		scope.account = request.params.account;
	if (request.params.asset !== undefined) scope.asset = request.params.asset;
	return scopedTransferInput(input as HubbleTransferInput, scope);
}

function sendError(response: Response, error: unknown): void {
	if (error instanceof HubbleWarehouseInputError) {
		response
			.status(400)
			.json({ code: 'invalid_hubble_query', error: error.message });
	} else if (error instanceof HubbleWarehouseUnavailableError) {
		console.error('Hubble transfer activity failed', error);
		response
			.status(503)
			.json({
				code: 'hubble_warehouse_unavailable',
				error:
					'The bounded transfer query could not be completed; narrow the ledger range or try again'
			});
	} else {
		console.error('Unexpected Hubble transfer failure', error);
		response
			.status(500)
			.json({
				code: 'hubble_query_failed',
				error: 'The transfer query could not be completed'
			});
	}
}
