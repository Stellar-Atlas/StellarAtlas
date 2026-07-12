import { StrKey } from '@stellar/stellar-sdk';
import type {
	FullHistoryCheckpointWrite,
	FullHistoryTransactionInput
} from './FullHistoryCanonicalBatch.js';
import {
	assertInteger,
	type FullHistoryHash,
	type FullHistoryLedgerSequence
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_OPERATION_FACT_SCOPE =
	'operation_body_and_envelope' as const;
export const FULL_HISTORY_MAX_OPERATIONS_PER_CHECKPOINT = 1_000_000;
export const FULL_HISTORY_OPERATION_QUERY_LIMIT_MAX = 100;

export const FULL_HISTORY_OPERATION_TYPES = [
	'account_merge',
	'allow_trust',
	'begin_sponsoring_future_reserves',
	'bump_sequence',
	'change_trust',
	'claim_claimable_balance',
	'clawback',
	'clawback_claimable_balance',
	'create_account',
	'create_claimable_balance',
	'create_passive_sell_offer',
	'end_sponsoring_future_reserves',
	'extend_footprint_ttl',
	'inflation',
	'invoke_host_function',
	'liquidity_pool_deposit',
	'liquidity_pool_withdraw',
	'manage_buy_offer',
	'manage_data',
	'manage_sell_offer',
	'path_payment_strict_receive',
	'path_payment_strict_send',
	'payment',
	'restore_footprint',
	'revoke_sponsorship',
	'set_options',
	'set_trust_line_flags'
] as const;

export type FullHistoryOperationType =
	(typeof FULL_HISTORY_OPERATION_TYPES)[number];
export type FullHistoryOperationFactScope =
	typeof FULL_HISTORY_OPERATION_FACT_SCOPE;
export type FullHistoryOperationSourceOrigin = 'operation' | 'transaction';

export interface FullHistoryOperationInput {
	readonly factScope: FullHistoryOperationFactScope;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationIndex: number;
	readonly operationType: FullHistoryOperationType;
	readonly sourceAccount: string;
	readonly sourceAccountOrigin: FullHistoryOperationSourceOrigin;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

export interface FullHistoryOperationQuery {
	readonly firstLedger?: FullHistoryLedgerSequence;
	readonly lastLedger?: FullHistoryLedgerSequence;
	readonly limit: number;
	readonly operationType?: FullHistoryOperationType;
	readonly sourceAccount?: string;
	readonly transactionHash?: FullHistoryHash;
}

export interface FullHistoryOperationView extends FullHistoryOperationInput {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly checkpointLedger: FullHistoryLedgerSequence;
	readonly checkpointProofId: number;
	readonly closedAt: Date;
	readonly decoderVersion: string;
	readonly outcomeAvailable: false;
	readonly proofEvaluatedAt: Date;
	readonly proofVersion: number;
}

export interface FullHistoryOperationPage {
	readonly coverage: FullHistoryOperationCoverage;
	readonly records: readonly FullHistoryOperationView[];
	readonly truncated: boolean;
}

export interface FullHistoryOperationCoverage {
	readonly canonicalBatches: number;
	readonly complete: boolean;
	readonly firstIndexedLedger: FullHistoryLedgerSequence | null;
	readonly indexedBatches: number;
	readonly lastIndexedLedger: FullHistoryLedgerSequence | null;
}

const operationTypes = new Set<string>(FULL_HISTORY_OPERATION_TYPES);

export function isFullHistoryOperationType(
	value: string
): value is FullHistoryOperationType {
	return operationTypes.has(value);
}

export function isFullHistoryOperationSourceAccount(value: string): boolean {
	return (
		StrKey.isValidEd25519PublicKey(value) ||
		StrKey.isValidMed25519PublicKey(value)
	);
}

export function validateFullHistoryOperations(
	input: Pick<
		FullHistoryCheckpointWrite,
		'operations' | 'transactions'
	>
): void {
	const expectedCount = input.transactions.reduce(
		(total, transaction) => total + transaction.operationCount,
		0
	);
	if (
		!Number.isSafeInteger(expectedCount) ||
		expectedCount > FULL_HISTORY_MAX_OPERATIONS_PER_CHECKPOINT ||
		input.operations.length !== expectedCount
	) {
		throw new RangeError('Canonical operation count is invalid');
	}

	const transactions = new Map(
		input.transactions.map((transaction) => [
			transaction.transactionHash.toHex(),
			transaction
		])
	);
	const operationIndexes = new Map<string, number[]>();
	for (const operation of input.operations) {
		validateOperation(operation);
		const hash = operation.transactionHash.toHex();
		const transaction = transactions.get(hash);
		if (!operationMatchesTransaction(operation, transaction)) {
			throw new Error('Canonical operation does not match its transaction');
		}
		operationIndexes.set(hash, [
			...(operationIndexes.get(hash) ?? []),
			operation.operationIndex
		]);
	}

	for (const transaction of input.transactions) {
		const indexes = (
			operationIndexes.get(transaction.transactionHash.toHex()) ?? []
		).toSorted((left, right) => left - right);
		if (
			indexes.length !== transaction.operationCount ||
			indexes.some((value, index) => value !== index)
		) {
			throw new Error(
				'Canonical operation indexes must exactly cover their transaction'
			);
		}
	}
}

function validateOperation(operation: FullHistoryOperationInput): void {
	assertInteger(operation.operationIndex, 'operationIndex', 0);
	assertInteger(operation.transactionIndex, 'transactionIndex', 0);
	if (operation.factScope !== FULL_HISTORY_OPERATION_FACT_SCOPE) {
		throw new Error('Operation fact scope must be envelope-only');
	}
	if (!isFullHistoryOperationType(operation.operationType)) {
		throw new Error('Operation type is unsupported');
	}
	if (!isFullHistoryOperationSourceAccount(operation.sourceAccount)) {
		throw new Error('Operation source account must be a valid Stellar StrKey');
	}
	if (!['operation', 'transaction'].includes(operation.sourceAccountOrigin)) {
		throw new Error('Operation source account origin is unsupported');
	}
}

function operationMatchesTransaction(
	operation: FullHistoryOperationInput,
	transaction: FullHistoryTransactionInput | undefined
): boolean {
	return (
		transaction !== undefined &&
		operation.ledgerSequence === transaction.ledgerSequence &&
		operation.transactionIndex === transaction.transactionIndex &&
		operation.operationIndex < transaction.operationCount &&
		(operation.sourceAccountOrigin !== 'transaction' ||
			operation.sourceAccount === transaction.sourceAccount)
	);
}
