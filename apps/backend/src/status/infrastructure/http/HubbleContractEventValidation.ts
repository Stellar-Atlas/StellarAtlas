import type { HubbleContractEventInput } from './HubbleContractEventContracts.js';
import { normalizeHubbleTransferInput } from './HubbleTransferValidation.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

const exactAddress = /^(?:G[A-Z2-7]{55}|C[A-Z2-7]{55})$/;
const hash = /^[a-fA-F0-9]{64}$/;
const ledger = /^[1-9][0-9]*$/;
export const maximumContractEventLedgerSpan = 2_147_483_647;

export function normalizeHubbleContractEventInput(
	input: HubbleContractEventInput
): HubbleContractEventInput {
	const {
		typeCode,
		successful,
		inSuccessfulContractCall,
		order,
		topic,
		search,
		includeSummary,
		minLedger,
		maxLedger,
		...shared
	} = input;
	const normalized = normalizeHubbleTransferInput(shared);
	if (!normalized.contractId)
		throw new HubbleWarehouseInputError('contractId is required');
	for (const [name, value] of Object.entries({ minLedger, maxLedger }))
		if (
			value !== undefined &&
			(!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
		)
			throw new HubbleWarehouseInputError(
				name + ' must be a positive bounded integer'
			);
	if (
		minLedger !== undefined &&
		maxLedger !== undefined &&
		minLedger > maxLedger
	)
		throw new HubbleWarehouseInputError('minLedger cannot exceed maxLedger');
	if (order !== undefined && order !== 'asc' && order !== 'desc')
		throw new HubbleWarehouseInputError('order must be asc or desc');
	if (
		topic !== undefined &&
		(typeof topic !== 'string' ||
			topic.trim().length < 1 ||
			topic.trim().length > 128 ||
			Array.from(topic).some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
			))
	)
		throw new HubbleWarehouseInputError(
			'topic must be 1 to 128 safe text characters'
		);
	if (search !== undefined) {
		if (typeof search !== 'string' || search.length < 1 || search.length > 128)
			throw new HubbleWarehouseInputError('search must be one non-empty value');
		if (
			!hash.test(search) &&
			!exactAddress.test(search) &&
			(!ledger.test(search) || Number(search) > 2_147_483_647)
		)
			throw new HubbleWarehouseInputError(
				'search must be an exact G/C address, 64-character transaction hash, or positive ledger'
			);
	}
	if (includeSummary !== undefined && typeof includeSummary !== 'boolean')
		throw new HubbleWarehouseInputError('includeSummary must be a boolean');
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
		...(minLedger === undefined ? {} : { minLedger }),
		...(maxLedger === undefined ? {} : { maxLedger }),
		...(typeCode == null ? {} : { typeCode }),
		...(successful == null ? {} : { successful }),
		...(inSuccessfulContractCall == null ? {} : { inSuccessfulContractCall }),
		order: order ?? 'desc',
		...(topic === undefined ? {} : { topic: topic.trim() }),
		...(search === undefined
			? {}
			: { search: hash.test(search) ? search.toLowerCase() : search }),
		includeSummary: includeSummary ?? false
	};
}
