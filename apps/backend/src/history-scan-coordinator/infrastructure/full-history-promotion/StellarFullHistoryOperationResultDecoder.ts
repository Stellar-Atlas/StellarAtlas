import { xdr } from '@stellar/stellar-sdk';
import type { FullHistoryTransactionInput } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
	isFullHistoryOperationResultCode,
	type FullHistoryOperationResultInput
} from '../../domain/full-history/FullHistoryCanonicalOperationResult.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';

export const STELLAR_FULL_HISTORY_OPERATION_RESULT_DECODER_VERSION =
	'stellar-sdk-16/transaction-result-xdr-v1-operation-results';

export function decodeStellarFullHistoryOperationResults(
	transactionResult: xdr.TransactionResult,
	transaction: FullHistoryTransactionInput
): FullHistoryOperationResultInput[] {
	const appliedResults = readAppliedResults(
		transactionResult,
		transaction.envelopeType === 'fee-bump'
	);
	if (appliedResults.length > transaction.operationCount) {
		throw pairingError('Operation-result count exceeds its transaction');
	}

	return Array.from(
		{ length: transaction.operationCount },
		(_, operationIndex) =>
			decodeOperationResult(
				appliedResults[operationIndex],
				operationIndex,
				transaction
			)
	);
}

function readAppliedResults(
	transactionResult: xdr.TransactionResult,
	feeBump: boolean
): readonly xdr.OperationResult[] {
	const outer = transactionResult.result();
	const outerCode = outer.switch().value;
	if (!feeBump) {
		return outerCode === 0 || outerCode === -1 ? outer.results() : [];
	}
	if (outerCode !== 1 && outerCode !== -13) return [];
	const inner = outer.innerResultPair().result().result();
	const innerCode = inner.switch().value;
	return innerCode === 0 || innerCode === -1 ? inner.results() : [];
}

function decodeOperationResult(
	result: xdr.OperationResult | undefined,
	operationIndex: number,
	transaction: FullHistoryTransactionInput
): FullHistoryOperationResultInput {
	const provenance = {
		factScope: FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
		ledgerSequence: transaction.ledgerSequence,
		operationIndex,
		transactionHash: transaction.transactionHash,
		transactionIndex: transaction.transactionIndex
	} as const;
	if (result === undefined) {
		return {
			...provenance,
			operationResultCode: null,
			operationSpecificResultCode: null,
			outcome: 'not_applied'
		};
	}

	const operationResultCode = result.switch().value;
	if (!isFullHistoryOperationResultCode(operationResultCode)) {
		throw pairingError('Top-level OperationResultCode is unsupported');
	}
	if (operationResultCode !== 0) {
		return {
			...provenance,
			operationResultCode,
			operationSpecificResultCode: null,
			outcome: 'failed'
		};
	}

	const operationSpecificResultCode = result.tr().value().switch().value;
	return {
		...provenance,
		operationResultCode,
		operationSpecificResultCode,
		outcome: operationSpecificResultCode === 0 ? 'succeeded' : 'failed'
	};
}

function pairingError(message: string): FullHistoryPromotionError {
	return new FullHistoryPromotionError('transaction-pairing-mismatch', message);
}
