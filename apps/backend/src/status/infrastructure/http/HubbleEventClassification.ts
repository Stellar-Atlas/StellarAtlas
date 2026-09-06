import { Asset, Networks, xdr } from '@stellar/stellar-sdk';

// Protocol MAX_OPS_PER_TX; the installed XDR declaration omits this constant.
export const maximumHubbleTransactionOperations = 100;
const invokeHostFunction = xdr.OperationType.invokeHostFunction().value;
const firstOperationType = xdr.OperationType.createAccount().value;
const lastOperationType = xdr.OperationType.restoreFootprint().value;
const nativeAssetContractId = Asset.native().contractId(Networks.PUBLIC);
const sorobanOperationTypes = new Set<number>([
	invokeHostFunction,
	xdr.OperationType.extendFootprintTtl().value,
	xdr.OperationType.restoreFootprint().value
]);

export interface HubbleEventOperation {
	readonly id: string;
	readonly type: number;
}

export interface HubbleEventProvenance {
	readonly transactionId: string;
	readonly ledgerSequence: number;
	readonly expectedOperationCount: number;
	readonly operations: readonly HubbleEventOperation[];
}

export interface HubbleEventClassification {
	readonly transactionKind: 'classic' | 'soroban' | 'unknown';
	readonly eventKind:
		'fee' | 'operation' | 'contract' | 'diagnostic' | 'unknown';
	/** Evidence of an invocation event, not a claim that the invocation succeeded. */
	readonly sorobanExecutionEvidence: boolean;
	readonly provenance: 'complete' | 'missing' | 'incomplete' | 'mismatch';
}

export function hubbleEventIdentifier(value: unknown): string | null {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) return null;
		value = String(value);
	}
	if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
		return null;
	return BigInt(value) <= 9223372036854775807n ? value : null;
}

export function hubbleEventLedger(value: unknown): number | null {
	const number =
		typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
	return typeof number === 'number' &&
		Number.isInteger(number) &&
		number >= 1 &&
		number <= 4294967295
		? number
		: null;
}

export function classifyHubbleEvent(
	event: Readonly<Record<string, unknown>>,
	context: HubbleEventProvenance | null
): HubbleEventClassification {
	const topics = event.topics_decoded;
	const firstTopic: unknown = decodeFirstTopic(
		Array.isArray(topics) ? topics[0] : null
	);
	// A user contract may also emit a topic called "fee". Only the native asset's
	// transaction-level contract event supplies protocol-fee provenance here.
	const fee =
		event.operation_id === null &&
		event.contract_id === nativeAssetContractId &&
		event.type === xdr.ContractEventType.contract().value &&
		typeof firstTopic === 'object' &&
		firstTopic !== null &&
		'symbol' in firstTopic &&
		firstTopic.symbol === 'fee';
	const unknown = (
		provenance: HubbleEventClassification['provenance']
	): HubbleEventClassification => ({
		transactionKind: 'unknown',
		eventKind: fee ? 'fee' : 'unknown',
		sorobanExecutionEvidence: false,
		provenance
	});
	if (context === null) return unknown('missing');
	if (
		hubbleEventIdentifier(event.transaction_id) !== context.transactionId ||
		hubbleEventLedger(event.ledger_sequence) !== context.ledgerSequence
	)
		return unknown('mismatch');
	const operations = new Map(
		context.operations.map((operation) => [operation.id, operation.type])
	);
	if (
		!Number.isSafeInteger(context.expectedOperationCount) ||
		context.expectedOperationCount < 1 ||
		context.expectedOperationCount > maximumHubbleTransactionOperations ||
		operations.size !== context.expectedOperationCount ||
		context.operations.some(
			(operation) =>
				hubbleEventIdentifier(operation.id) === null ||
				!Number.isInteger(operation.type) ||
				operation.type < firstOperationType ||
				operation.type > lastOperationType
		) ||
		context.operations.some(
			(operation) => operations.get(operation.id) !== operation.type
		)
	)
		return unknown('incomplete');
	const types = [...operations.values()];
	// Footprint maintenance is Soroban, but is not itself contract invocation evidence.
	const transactionKind = types.some((type) => sorobanOperationTypes.has(type))
		? 'soroban'
		: 'classic';
	const operationId =
		event.operation_id === null || event.operation_id === undefined
			? null
			: hubbleEventIdentifier(event.operation_id);
	if (
		event.operation_id !== null &&
		event.operation_id !== undefined &&
		(operationId === null || !operations.has(operationId))
	)
		return unknown('mismatch');
	const invokes =
		operationId === null
			? operations.size === 1 && types[0] === invokeHostFunction
			: operations.get(operationId) === invokeHostFunction;
	const eventKind: HubbleEventClassification['eventKind'] = fee
		? 'fee'
		: event.type === xdr.ContractEventType.diagnostic().value
			? 'diagnostic'
			: event.type === xdr.ContractEventType.contract().value && invokes
				? 'contract'
				: operationId !== null && transactionKind === 'classic'
					? 'operation'
					: 'unknown';
	return {
		transactionKind,
		eventKind,
		provenance: 'complete',
		sorobanExecutionEvidence:
			invokes && (eventKind === 'contract' || eventKind === 'diagnostic')
	};
}

/** ClickHouse stores decoded topic values as JSON strings; retain original row values. */
function decodeFirstTopic(topic: unknown): unknown {
	if (typeof topic !== 'string') return topic;
	try {
		return JSON.parse(topic) as unknown;
	} catch {
		return null;
	}
}
