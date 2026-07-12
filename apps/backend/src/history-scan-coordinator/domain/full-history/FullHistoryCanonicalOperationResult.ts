import type {
	FullHistoryCheckpointWrite,
	FullHistoryTransactionInput
} from './FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationInput } from './FullHistoryCanonicalOperation.js';
import {
	assertInteger,
	type FullHistoryHash,
	type FullHistoryLedgerSequence
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE =
	'transaction_result_xdr' as const;

export const FULL_HISTORY_OPERATION_RESULT_CODES = [
	-6, -5, -4, -3, -2, -1, 0
] as const;

export type FullHistoryOperationResultCode =
	(typeof FULL_HISTORY_OPERATION_RESULT_CODES)[number];
export type FullHistoryOperationResultFactScope =
	typeof FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE;
export type FullHistoryOperationOutcome =
	'failed' | 'not_applied' | 'succeeded';

export interface FullHistoryOperationResultInput {
	readonly factScope: FullHistoryOperationResultFactScope;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationIndex: number;
	readonly operationResultCode: FullHistoryOperationResultCode | null;
	readonly operationSpecificResultCode: number | null;
	readonly outcome: FullHistoryOperationOutcome;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

const operationResultCodes = new Set<number>(
	FULL_HISTORY_OPERATION_RESULT_CODES
);

export function isFullHistoryOperationResultCode(
	value: number
): value is FullHistoryOperationResultCode {
	return operationResultCodes.has(value);
}

export function validateFullHistoryOperationResults(
	input: Pick<
		FullHistoryCheckpointWrite,
		'operationResults' | 'operations' | 'transactions'
	>
): void {
	if (input.operationResults.length !== input.operations.length) {
		throw new RangeError(
			'Canonical operation-result count must equal the operation count'
		);
	}

	const operations = new Map(
		input.operations.map((operation) => [
			operationIdentity(operation),
			operation
		])
	);
	const transactions = new Map(
		input.transactions.map((transaction) => [
			transaction.transactionHash.toHex(),
			transaction
		])
	);
	const identities = new Set<string>();
	for (const result of input.operationResults) {
		validateOperationResult(result);
		const identity = operationResultIdentity(result);
		if (
			identities.has(identity) ||
			!resultMatchesOperation(result, operations.get(identity)) ||
			!resultMatchesTransaction(
				result,
				transactions.get(result.transactionHash.toHex())
			)
		) {
			throw new Error(
				'Canonical operation results must map one-to-one to operations'
			);
		}
		identities.add(identity);
	}
}

function validateOperationResult(
	result: FullHistoryOperationResultInput
): void {
	assertInteger(result.operationIndex, 'operationIndex', 0);
	assertInteger(result.transactionIndex, 'transactionIndex', 0);
	if (result.factScope !== FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE) {
		throw new Error(
			'Operation-result fact scope must be transaction result XDR'
		);
	}
	if (
		result.operationResultCode !== null &&
		!isFullHistoryOperationResultCode(result.operationResultCode)
	) {
		throw new Error('Top-level OperationResultCode is unsupported');
	}
	if (result.operationSpecificResultCode !== null) {
		assertInteger(
			result.operationSpecificResultCode,
			'operationSpecificResultCode',
			-0x8000_0000,
			0x7fff_ffff
		);
	}
	if (!outcomeMatchesCodes(result)) {
		throw new Error('Operation outcome does not match its XDR result codes');
	}
}

function outcomeMatchesCodes(result: FullHistoryOperationResultInput): boolean {
	if (result.outcome === 'not_applied') {
		return (
			result.operationResultCode === null &&
			result.operationSpecificResultCode === null
		);
	}
	if (result.outcome === 'succeeded') {
		return (
			result.operationResultCode === 0 &&
			result.operationSpecificResultCode === 0
		);
	}
	return (
		result.outcome === 'failed' &&
		((result.operationResultCode !== null &&
			result.operationResultCode < 0 &&
			result.operationSpecificResultCode === null) ||
			(result.operationResultCode === 0 &&
				result.operationSpecificResultCode !== null &&
				result.operationSpecificResultCode !== 0))
	);
}

function resultMatchesOperation(
	result: FullHistoryOperationResultInput,
	operation: FullHistoryOperationInput | undefined
): boolean {
	return (
		operation !== undefined &&
		result.ledgerSequence === operation.ledgerSequence &&
		result.transactionIndex === operation.transactionIndex
	);
}

function resultMatchesTransaction(
	result: FullHistoryOperationResultInput,
	transaction: FullHistoryTransactionInput | undefined
): boolean {
	return (
		transaction !== undefined &&
		result.ledgerSequence === transaction.ledgerSequence &&
		result.transactionIndex === transaction.transactionIndex &&
		result.operationIndex < transaction.operationCount
	);
}

function operationIdentity(operation: FullHistoryOperationInput): string {
	return `${operation.transactionHash.toHex()}:${operation.operationIndex}`;
}

function operationResultIdentity(
	result: FullHistoryOperationResultInput
): string {
	return `${result.transactionHash.toHex()}:${result.operationIndex}`;
}
