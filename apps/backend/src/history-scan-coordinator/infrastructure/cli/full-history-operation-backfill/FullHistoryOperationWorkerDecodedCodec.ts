import {
	FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT,
	type FullHistoryEnvelopeType
} from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	FULL_HISTORY_MAX_OPERATIONS_PER_CHECKPOINT,
	FULL_HISTORY_OPERATION_FACT_SCOPE,
	isFullHistoryOperationType,
	type FullHistoryOperationSourceOrigin
} from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
import type { FullHistoryDecodedCheckpoint } from '../../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	readWorkerArray,
	readWorkerBoolean,
	readWorkerDate,
	readWorkerHash,
	readWorkerInteger,
	readWorkerRecord,
	readWorkerString
} from './FullHistoryOperationWorkerValueParser.js';

export interface WireDecodedCheckpoint {
	readonly ledgers: readonly {
		readonly bucketListHash: string;
		readonly closedAt: string;
		readonly ledgerHash: string;
		readonly ledgerSequence: string;
		readonly previousLedgerHash: string;
		readonly protocolVersion: number;
		readonly transactionCount: number;
		readonly transactionResultHash: string;
		readonly transactionSetHash: string;
	}[];
	readonly operations: readonly {
		readonly factScope: string;
		readonly ledgerSequence: string;
		readonly operationIndex: number;
		readonly operationType: string;
		readonly sourceAccount: string;
		readonly sourceAccountOrigin: string;
		readonly transactionHash: string;
		readonly transactionIndex: number;
	}[];
	readonly results: readonly {
		readonly feeCharged: string;
		readonly ledgerSequence: string;
		readonly operationResultCount: number;
		readonly resultCode: number;
		readonly successful: boolean;
		readonly transactionHash: string;
		readonly transactionIndex: number;
	}[];
	readonly transactions: readonly {
		readonly envelopeType: string;
		readonly feeBid: string;
		readonly ledgerSequence: string;
		readonly operationCount: number;
		readonly sourceAccount: string;
		readonly sourceAccountSequence: string;
		readonly transactionHash: string;
		readonly transactionIndex: number;
	}[];
}

export function serializeFullHistoryOperationWorkerDecodedCheckpoint(
	decoded: FullHistoryDecodedCheckpoint
): WireDecodedCheckpoint {
	return {
		ledgers: decoded.ledgers.map((ledger) => ({
			bucketListHash: ledger.bucketListHash.toHex(),
			closedAt: ledger.closedAt.toISOString(),
			ledgerHash: ledger.ledgerHash.toHex(),
			ledgerSequence: ledger.ledgerSequence,
			previousLedgerHash: ledger.previousLedgerHash.toHex(),
			protocolVersion: ledger.protocolVersion,
			transactionCount: ledger.transactionCount,
			transactionResultHash: ledger.transactionResultHash.toHex(),
			transactionSetHash: ledger.transactionSetHash.toHex()
		})),
		operations: decoded.operations.map((operation) => ({
			factScope: operation.factScope,
			ledgerSequence: operation.ledgerSequence,
			operationIndex: operation.operationIndex,
			operationType: operation.operationType,
			sourceAccount: operation.sourceAccount,
			sourceAccountOrigin: operation.sourceAccountOrigin,
			transactionHash: operation.transactionHash.toHex(),
			transactionIndex: operation.transactionIndex
		})),
		results: decoded.results.map((result) => ({
			feeCharged: result.feeCharged,
			ledgerSequence: result.ledgerSequence,
			operationResultCount: result.operationResultCount,
			resultCode: result.resultCode,
			successful: result.successful,
			transactionHash: result.transactionHash.toHex(),
			transactionIndex: result.transactionIndex
		})),
		transactions: decoded.transactions.map((transaction) => ({
			envelopeType: transaction.envelopeType,
			feeBid: transaction.feeBid,
			ledgerSequence: transaction.ledgerSequence,
			operationCount: transaction.operationCount,
			sourceAccount: transaction.sourceAccount,
			sourceAccountSequence: transaction.sourceAccountSequence,
			transactionHash: transaction.transactionHash.toHex(),
			transactionIndex: transaction.transactionIndex
		}))
	};
}

export function parseFullHistoryOperationWorkerDecodedCheckpoint(
	value: unknown
): FullHistoryDecodedCheckpoint {
	const decoded = readWorkerRecord(value, 'worker decoded checkpoint');
	return {
		ledgers: readWorkerArray(decoded.ledgers, 'decoded.ledgers', 64).map(
			(value, index) => {
				const ledger = readWorkerRecord(value, `ledgers[${index}]`);
				return {
					bucketListHash: readWorkerHash(
						ledger.bucketListHash,
						`ledgers[${index}].bucketListHash`
					),
					closedAt: readWorkerDate(
						ledger.closedAt,
						`ledgers[${index}].closedAt`
					),
					ledgerHash: readWorkerHash(
						ledger.ledgerHash,
						`ledgers[${index}].ledgerHash`
					),
					ledgerSequence: readLedgerSequence(
						ledger.ledgerSequence,
						`ledgers[${index}].ledgerSequence`
					),
					previousLedgerHash: readWorkerHash(
						ledger.previousLedgerHash,
						`ledgers[${index}].previousLedgerHash`
					),
					protocolVersion: readWorkerInteger(
						ledger.protocolVersion,
						`ledgers[${index}].protocolVersion`,
						1
					),
					transactionCount: readWorkerInteger(
						ledger.transactionCount,
						`ledgers[${index}].transactionCount`,
						0,
						FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT
					),
					transactionResultHash: readWorkerHash(
						ledger.transactionResultHash,
						`ledgers[${index}].transactionResultHash`
					),
					transactionSetHash: readWorkerHash(
						ledger.transactionSetHash,
						`ledgers[${index}].transactionSetHash`
					)
				};
			}
		),
		operations: readWorkerArray(
			decoded.operations,
			'decoded.operations',
			FULL_HISTORY_MAX_OPERATIONS_PER_CHECKPOINT
		).map((value, index) => {
			const operation = readWorkerRecord(value, `operations[${index}]`);
			const operationType = readWorkerString(
				operation.operationType,
				`operations[${index}].operationType`,
				64
			);
			if (!isFullHistoryOperationType(operationType)) {
				throw new TypeError(
					`operations[${index}].operationType is unsupported`
				);
			}
			return {
				factScope: readFactScope(
					operation.factScope,
					`operations[${index}].factScope`
				),
				ledgerSequence: readLedgerSequence(
					operation.ledgerSequence,
					`operations[${index}].ledgerSequence`
				),
				operationIndex: readWorkerInteger(
					operation.operationIndex,
					`operations[${index}].operationIndex`,
					0
				),
				operationType,
				sourceAccount: readWorkerString(
					operation.sourceAccount,
					`operations[${index}].sourceAccount`,
					128
				),
				sourceAccountOrigin: readSourceOrigin(
					operation.sourceAccountOrigin,
					`operations[${index}].sourceAccountOrigin`
				),
				transactionHash: readWorkerHash(
					operation.transactionHash,
					`operations[${index}].transactionHash`
				),
				transactionIndex: readWorkerInteger(
					operation.transactionIndex,
					`operations[${index}].transactionIndex`,
					0
				)
			};
		}),
		results: readWorkerArray(
			decoded.results,
			'decoded.results',
			FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT
		).map((value, index) => {
			const result = readWorkerRecord(value, `results[${index}]`);
			return {
				feeCharged: fullHistoryUint64(
					readWorkerString(
						result.feeCharged,
						`results[${index}].feeCharged`,
						20
					),
					`results[${index}].feeCharged`
				),
				ledgerSequence: readLedgerSequence(
					result.ledgerSequence,
					`results[${index}].ledgerSequence`
				),
				operationResultCount: readWorkerInteger(
					result.operationResultCount,
					`results[${index}].operationResultCount`,
					0
				),
				resultCode: readWorkerInteger(
					result.resultCode,
					`results[${index}].resultCode`,
					-0x8000_0000,
					0x7fff_ffff
				),
				successful: readWorkerBoolean(
					result.successful,
					`results[${index}].successful`
				),
				transactionHash: readWorkerHash(
					result.transactionHash,
					`results[${index}].transactionHash`
				),
				transactionIndex: readWorkerInteger(
					result.transactionIndex,
					`results[${index}].transactionIndex`,
					0
				)
			};
		}),
		transactions: readWorkerArray(
			decoded.transactions,
			'decoded.transactions',
			FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT
		).map((value, index) => parseTransaction(value, index))
	};
}

function parseTransaction(value: unknown, index: number) {
	const transaction = readWorkerRecord(value, `transactions[${index}]`);
	return {
		envelopeType: readEnvelopeType(
			transaction.envelopeType,
			`transactions[${index}].envelopeType`
		),
		feeBid: fullHistoryUint64(
			readWorkerString(transaction.feeBid, `transactions[${index}].feeBid`, 20),
			`transactions[${index}].feeBid`
		),
		ledgerSequence: readLedgerSequence(
			transaction.ledgerSequence,
			`transactions[${index}].ledgerSequence`
		),
		operationCount: readWorkerInteger(
			transaction.operationCount,
			`transactions[${index}].operationCount`,
			0
		),
		sourceAccount: readWorkerString(
			transaction.sourceAccount,
			`transactions[${index}].sourceAccount`,
			128
		),
		sourceAccountSequence: fullHistoryUint64(
			readWorkerString(
				transaction.sourceAccountSequence,
				`transactions[${index}].sourceAccountSequence`,
				20
			),
			`transactions[${index}].sourceAccountSequence`
		),
		transactionHash: readWorkerHash(
			transaction.transactionHash,
			`transactions[${index}].transactionHash`
		),
		transactionIndex: readWorkerInteger(
			transaction.transactionIndex,
			`transactions[${index}].transactionIndex`,
			0
		)
	};
}

function readEnvelopeType(
	value: unknown,
	field: string
): FullHistoryEnvelopeType {
	const parsed = readWorkerString(value, field, 16);
	if (parsed !== 'fee-bump' && parsed !== 'tx' && parsed !== 'tx-v0') {
		throw new TypeError(`${field} is unsupported`);
	}
	return parsed;
}

function readFactScope(value: unknown, field: string) {
	if (value !== FULL_HISTORY_OPERATION_FACT_SCOPE) {
		throw new TypeError(`${field} is unsupported`);
	}
	return FULL_HISTORY_OPERATION_FACT_SCOPE;
}

function readSourceOrigin(
	value: unknown,
	field: string
): FullHistoryOperationSourceOrigin {
	if (value !== 'operation' && value !== 'transaction') {
		throw new TypeError(`${field} is unsupported`);
	}
	return value;
}

function readLedgerSequence(value: unknown, field: string) {
	return fullHistoryLedgerSequence(readWorkerString(value, field, 20), field);
}
