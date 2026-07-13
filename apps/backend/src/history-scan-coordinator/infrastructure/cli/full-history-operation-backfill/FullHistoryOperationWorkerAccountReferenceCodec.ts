import {
	FULL_HISTORY_MAX_OPERATION_ACCOUNT_REFERENCES_PER_CHECKPOINT,
	FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
	fullHistoryBaseAccountId,
	isFullHistoryOperationAccountReferenceRole,
	type FullHistoryOperationAccountReferenceInput
} from '../../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
import { fullHistoryLedgerSequence } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	readWorkerArray,
	readWorkerHash,
	readWorkerInteger,
	readWorkerRecord,
	readWorkerString
} from './FullHistoryOperationWorkerValueParser.js';

export interface WireOperationAccountReference {
	readonly accountId: string;
	readonly baseAccountId: string;
	readonly factScope: string;
	readonly ledgerSequence: string;
	readonly operationIndex: number;
	readonly role: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
}

export function serializeOperationAccountReferences(
	references: readonly FullHistoryOperationAccountReferenceInput[]
): readonly WireOperationAccountReference[] {
	return references.map((reference) => ({
		accountId: reference.accountId,
		baseAccountId: reference.baseAccountId,
		factScope: reference.factScope,
		ledgerSequence: reference.ledgerSequence,
		operationIndex: reference.operationIndex,
		role: reference.role,
		transactionHash: reference.transactionHash.toHex(),
		transactionIndex: reference.transactionIndex
	}));
}

export function parseOperationAccountReferences(
	value: unknown
): readonly FullHistoryOperationAccountReferenceInput[] {
	return readWorkerArray(
		value,
		'decoded.operationAccountReferences',
		FULL_HISTORY_MAX_OPERATION_ACCOUNT_REFERENCES_PER_CHECKPOINT
	).map((value, index) => parseAccountReference(value, index));
}

function parseAccountReference(
	value: unknown,
	index: number
): FullHistoryOperationAccountReferenceInput {
	const field = `operationAccountReferences[${index}]`;
	const reference = readWorkerRecord(value, field);
	const accountId = readWorkerString(
		reference.accountId,
		`${field}.accountId`,
		128
	);
	const baseAccountId = readWorkerString(
		reference.baseAccountId,
		`${field}.baseAccountId`,
		128
	);
	if (fullHistoryBaseAccountId(accountId) !== baseAccountId) {
		throw new TypeError(`${field}.baseAccountId does not match accountId`);
	}
	const role = readWorkerString(reference.role, `${field}.role`, 32);
	if (!isFullHistoryOperationAccountReferenceRole(role)) {
		throw new TypeError(`${field}.role is unsupported`);
	}
	if (
		reference.factScope !== FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE
	) {
		throw new TypeError(`${field}.factScope is unsupported`);
	}
	return {
		accountId,
		baseAccountId,
		factScope: FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
		ledgerSequence: fullHistoryLedgerSequence(
			readWorkerString(reference.ledgerSequence, `${field}.ledgerSequence`, 20),
			`${field}.ledgerSequence`
		),
		operationIndex: readWorkerInteger(
			reference.operationIndex,
			`${field}.operationIndex`,
			0
		),
		role,
		transactionHash: readWorkerHash(
			reference.transactionHash,
			`${field}.transactionHash`
		),
		transactionIndex: readWorkerInteger(
			reference.transactionIndex,
			`${field}.transactionIndex`,
			0
		)
	};
}
