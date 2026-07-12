import type {
	FullHistoryOperationPage,
	FullHistoryOperationQuery,
	FullHistoryOperationView
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';

export interface ExplorerCanonicalOperationDTO {
	readonly closedAt: string;
	readonly evidence: {
		readonly archiveSource: string;
		readonly batchId: string;
		readonly checkpointLedger: string;
		readonly checkpointProofId: number;
		readonly decoderVersion: string;
		readonly proofEvaluatedAt: string;
		readonly proofVersion: number;
	};
	readonly factScope: 'operation_body_and_envelope';
	readonly ledger: string;
	readonly operationIndex: number;
	readonly outcomeAvailable: false;
	readonly source: 'postgres_canonical';
	readonly sourceAccount: string;
	readonly sourceAccountOrigin: 'operation' | 'transaction';
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly type: FullHistoryOperationView['operationType'];
}

export interface ExplorerLocalOperationsDTO {
	readonly count: number;
	readonly coverage: {
		readonly canonicalBatches: number;
		readonly complete: boolean;
		readonly firstIndexedLedger: string | null;
		readonly indexedBatches: number;
		readonly lastIndexedLedger: string | null;
	};
	readonly factBoundary: {
		readonly includes: 'operation_type_and_effective_source';
		readonly outcomes: 'unavailable_without_ledger_close_meta';
	};
	readonly filters: {
		readonly firstLedger?: string;
		readonly lastLedger?: string;
		readonly operationType?: string;
		readonly sourceAccount?: string;
		readonly transactionHash?: string;
	};
	readonly generatedAt: string;
	readonly limit: number;
	readonly records: readonly ExplorerCanonicalOperationDTO[];
	readonly source: 'postgres_canonical';
	readonly truncated: boolean;
}

export function mapExplorerCanonicalOperations(
	page: FullHistoryOperationPage,
	query: FullHistoryOperationQuery
): ExplorerLocalOperationsDTO {
	return {
		count: page.records.length,
		coverage: {
			canonicalBatches: page.coverage.canonicalBatches,
			complete: page.coverage.complete,
			firstIndexedLedger: page.coverage.firstIndexedLedger,
			indexedBatches: page.coverage.indexedBatches,
			lastIndexedLedger: page.coverage.lastIndexedLedger
		},
		factBoundary: {
			includes: 'operation_type_and_effective_source',
			outcomes: 'unavailable_without_ledger_close_meta'
		},
		filters: {
			...(query.firstLedger === undefined
				? {}
				: { firstLedger: query.firstLedger }),
			...(query.lastLedger === undefined
				? {}
				: { lastLedger: query.lastLedger }),
			...(query.operationType === undefined
				? {}
				: { operationType: query.operationType }),
			...(query.sourceAccount === undefined
				? {}
				: { sourceAccount: query.sourceAccount }),
			...(query.transactionHash === undefined
				? {}
				: { transactionHash: query.transactionHash.toHex() })
		},
		generatedAt: new Date().toISOString(),
		limit: query.limit,
		records: page.records.map(mapExplorerCanonicalOperation),
		source: 'postgres_canonical',
		truncated: page.truncated
	};
}

function mapExplorerCanonicalOperation(
	operation: FullHistoryOperationView
): ExplorerCanonicalOperationDTO {
	return {
		closedAt: operation.closedAt.toISOString(),
		evidence: {
			archiveSource: operation.archiveUrlIdentity,
			batchId: operation.batchId,
			checkpointLedger: operation.checkpointLedger,
			checkpointProofId: operation.checkpointProofId,
			decoderVersion: operation.decoderVersion,
			proofEvaluatedAt: operation.proofEvaluatedAt.toISOString(),
			proofVersion: operation.proofVersion
		},
		factScope: operation.factScope,
		ledger: operation.ledgerSequence,
		operationIndex: operation.operationIndex,
		outcomeAvailable: false,
		source: 'postgres_canonical',
		sourceAccount: operation.sourceAccount,
		sourceAccountOrigin: operation.sourceAccountOrigin,
		transactionHash: operation.transactionHash.toHex(),
		transactionIndex: operation.transactionIndex,
		type: operation.operationType
	};
}
