import type { HubbleContractEventInput } from './HubbleContractEventContracts.js';
import { normalizeHubbleTransferInput } from './HubbleTransferValidation.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

export function normalizeHubbleContractEventInput(
	input: HubbleContractEventInput
): HubbleContractEventInput {
	const { typeCode, successful, inSuccessfulContractCall, ...shared } = input;
	const normalized = normalizeHubbleTransferInput(shared);
	if (!normalized.contractId)
		throw new HubbleWarehouseInputError('contractId is required');
	if (
		typeCode !== undefined &&
		typeCode !== null &&
		(!Number.isInteger(typeCode) || ![0, 1, 2].includes(typeCode))
	)
		throw new HubbleWarehouseInputError(
			'typeCode must be 0 (system), 1 (contract), or 2 (diagnostic)'
		);
	for (const [name, value] of Object.entries({
		successful,
		inSuccessfulContractCall
	}))
		if (value !== undefined && value !== null && typeof value !== 'boolean')
			throw new HubbleWarehouseInputError(name + ' must be a boolean');
	// Reject transfer-only fields rather than silently accepting ignored filters.
	const allowed = new Set([
		'contractId',
		'transactionHash',
		'minLedger',
		'maxLedger',
		'startTime',
		'endTime',
		'limit',
		'after'
	]);
	for (const key of Object.keys(shared))
		if (!allowed.has(key))
			throw new HubbleWarehouseInputError(
				'Unknown contract-event filter: ' + key
			);
	return {
		...normalized,
		contractId: normalized.contractId,
		...(typeCode == null ? {} : { typeCode }),
		...(successful == null ? {} : { successful }),
		...(inSuccessfulContractCall == null ? {} : { inSuccessfulContractCall })
	};
}
