import type { Request, Router } from 'express';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import type { HubbleContractEventInput } from './HubbleContractEventContracts.js';
import { normalizeHubbleContractEventInput } from './HubbleContractEventValidation.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';

const names: Readonly<Record<string, keyof HubbleContractEventInput>> = {
	transaction_hash: 'transactionHash',
	min_ledger: 'minLedger',
	max_ledger: 'maxLedger',
	start_time: 'startTime',
	end_time: 'endTime',
	type_code: 'typeCode',
	successful: 'successful',
	in_successful_contract_call: 'inSuccessfulContractCall',
	limit: 'limit',
	after: 'after'
};
export function registerHubbleContractEventRoutes(
	router: Router,
	warehouse: HubbleWarehouse
): void {
	router.get(
		'/contracts/:contractId/events',
		async (request, response, next) => {
			if (request.query.view !== 'typed') {
				next();
				return;
			}
			response.setHeader('Cache-Control', 'no-store');
			try {
				response.json(
					await warehouse.contractEvents(parseContractEventRequest(request))
				);
			} catch (error) {
				if (error instanceof HubbleWarehouseInputError) {
					response
						.status(400)
						.json({ code: 'invalid_hubble_query', error: error.message });
					return;
				}
				const unavailable = error instanceof HubbleWarehouseUnavailableError;
				console.error('Typed contract-event query failed', error);
				response.status(unavailable ? 503 : 500).json({
					code: unavailable
						? 'hubble_warehouse_unavailable'
						: 'hubble_query_failed',
					error:
						'The bounded contract-event query could not be completed; narrow the range or retry'
				});
			}
		}
	);
}
function parseContractEventRequest(request: Request): HubbleContractEventInput {
	const input: Record<string, string | number | boolean> = {
		contractId: request.params.contractId!
	};
	for (const [name, value] of Object.entries(request.query)) {
		if (name === 'view') continue;
		const field = names[name];
		if (!field || typeof value !== 'string' || value === '')
			throw new HubbleWarehouseInputError(
				'Unknown or repeated contract-event parameter: ' + name
			);
		if (['limit', 'minLedger', 'maxLedger', 'typeCode'].includes(field)) {
			if (!/^[0-9]+$/.test(value))
				throw new HubbleWarehouseInputError(name + ' must be an integer');
			input[field] = Number(value);
		} else if (field === 'successful' || field === 'inSuccessfulContractCall') {
			if (value !== 'true' && value !== 'false')
				throw new HubbleWarehouseInputError(name + ' must be true or false');
			input[field] = value === 'true';
		} else input[field] = value;
	}
	return normalizeHubbleContractEventInput(
		input as unknown as HubbleContractEventInput
	);
}
