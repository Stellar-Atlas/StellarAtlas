import type {
	FullHistoryOperationPage,
	FullHistoryOperationQuery,
	FullHistoryOperationView
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';
import type { FullHistoryOperationAccountReferenceRole } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
import type {
	FullHistoryOperationOutcome,
	FullHistoryOperationResultCode
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperationResult.js';

interface ExplorerCanonicalOperationBaseDTO {
	readonly createdAt: string;
	readonly evidence: {
		readonly accountReferenceDecoderVersion: string | null;
		readonly archiveSource: string;
		readonly batchId: string;
		readonly checkpointLedger: string;
		readonly checkpointProofId: number;
		readonly decoderVersion: string;
		readonly proofEvaluatedAt: string;
		readonly proofVersion: number;
	};
	readonly factScope: 'operation_body_and_envelope';
	readonly accountReferences: readonly {
		readonly accountId: string;
		readonly baseAccountId: string;
		readonly role: FullHistoryOperationAccountReferenceRole;
	}[];
	readonly id: string;
	readonly ledger: string;
	readonly operationIndex: number;
	readonly source: 'postgres_canonical';
	readonly sourceAccount: string;
	readonly sourceAccountOrigin: 'operation' | 'transaction';
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly type: FullHistoryOperationView['operationType'];
}

interface ExplorerCanonicalOperationOutcomeAvailableDTO {
	readonly operationResultCode: FullHistoryOperationResultCode | null;
	readonly operationSpecificResultCode: number | null;
	readonly outcome: FullHistoryOperationOutcome;
	readonly outcomeAvailable: true;
	readonly outcomeEvidence: {
		readonly decoderVersion: string;
		readonly factScope: 'transaction_result_xdr';
	};
}

interface ExplorerCanonicalOperationOutcomeUnavailableDTO {
	readonly operationResultCode: null;
	readonly operationSpecificResultCode: null;
	readonly outcome: null;
	readonly outcomeAvailable: false;
	readonly outcomeEvidence: null;
}

export type ExplorerCanonicalOperationDTO = ExplorerCanonicalOperationBaseDTO &
	(
		| ExplorerCanonicalOperationOutcomeAvailableDTO
		| ExplorerCanonicalOperationOutcomeUnavailableDTO
	);

export interface ExplorerLocalOperationsDTO {
	readonly count: number;
	readonly coverage: {
		readonly accountReferenceIndexedBatches: number;
		readonly accountReferencesComplete: boolean;
		readonly canonicalBatches: number;
		readonly complete: boolean;
		readonly firstAccountReferenceIndexedLedger: string | null;
		readonly firstIndexedLedger: string | null;
		readonly firstOutcomeIndexedLedger: string | null;
		readonly indexedBatches: number;
		readonly lastAccountReferenceIndexedLedger: string | null;
		readonly lastIndexedLedger: string | null;
		readonly lastOutcomeIndexedLedger: string | null;
		readonly outcomeIndexedBatches: number;
		readonly operationFactsComplete: boolean;
		readonly outcomesComplete: boolean;
	};
	readonly factBoundary: {
		readonly excludes: 'state_effects_soroban_auth_signers_and_asset_issuers';
		readonly includes: 'operation_type_effective_source_and_explicit_envelope_account_references';
		readonly outcomes: 'transaction_result_xdr_when_indexed';
	};
	readonly filters: {
		readonly accountId?: string;
		readonly firstLedger?: string;
		readonly from?: string;
		readonly ledger?: string;
		readonly lastLedger?: string;
		readonly operationType?: string;
		readonly to?: string;
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
			accountReferenceIndexedBatches:
				page.coverage.accountReferenceIndexedBatches,
			accountReferencesComplete: page.coverage.accountReferencesComplete,
			canonicalBatches: page.coverage.canonicalBatches,
			complete: page.coverage.complete,
			firstAccountReferenceIndexedLedger:
				page.coverage.firstAccountReferenceIndexedLedger,
			firstIndexedLedger: page.coverage.firstIndexedLedger,
			firstOutcomeIndexedLedger: page.coverage.firstOutcomeIndexedLedger,
			indexedBatches: page.coverage.indexedBatches,
			lastAccountReferenceIndexedLedger:
				page.coverage.lastAccountReferenceIndexedLedger,
			lastIndexedLedger: page.coverage.lastIndexedLedger,
			lastOutcomeIndexedLedger: page.coverage.lastOutcomeIndexedLedger,
			outcomeIndexedBatches: page.coverage.outcomeIndexedBatches,
			operationFactsComplete: page.coverage.operationFactsComplete,
			outcomesComplete: page.coverage.outcomesComplete
		},
		factBoundary: {
			excludes: 'state_effects_soroban_auth_signers_and_asset_issuers',
			includes:
				'operation_type_effective_source_and_explicit_envelope_account_references',
			outcomes: 'transaction_result_xdr_when_indexed'
		},
		filters: {
			...(query.accountId === undefined ? {} : { accountId: query.accountId }),
			...(query.closedAtFrom === undefined
				? {}
				: { from: query.closedAtFrom.toISOString() }),
			...(query.firstLedger === undefined
				? {}
				: { firstLedger: query.firstLedger }),
			...(query.lastLedger === undefined
				? {}
				: { lastLedger: query.lastLedger }),
			...(query.firstLedger !== undefined &&
			query.firstLedger === query.lastLedger
				? { ledger: query.firstLedger }
				: {}),
			...(query.operationType === undefined
				? {}
				: { operationType: query.operationType }),
			...(query.closedAtTo === undefined
				? {}
				: { to: query.closedAtTo.toISOString() }),
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
	const transactionHash = operation.transactionHash.toHex();
	const base: ExplorerCanonicalOperationBaseDTO = {
		accountReferences: operation.accountReferences.map((reference) => ({
			...reference
		})),
		createdAt: operation.closedAt.toISOString(),
		evidence: {
			accountReferenceDecoderVersion: operation.accountReferenceDecoderVersion,
			archiveSource: operation.archiveUrlIdentity,
			batchId: operation.batchId,
			checkpointLedger: operation.checkpointLedger,
			checkpointProofId: operation.checkpointProofId,
			decoderVersion: operation.decoderVersion,
			proofEvaluatedAt: operation.proofEvaluatedAt.toISOString(),
			proofVersion: operation.proofVersion
		},
		factScope: operation.factScope,
		id: `${transactionHash}:${operation.operationIndex}`,
		ledger: operation.ledgerSequence,
		operationIndex: operation.operationIndex,
		source: 'postgres_canonical',
		sourceAccount: operation.sourceAccount,
		sourceAccountOrigin: operation.sourceAccountOrigin,
		transactionHash,
		transactionIndex: operation.transactionIndex,
		type: operation.operationType
	};
	if (!operation.outcomeAvailable) {
		return {
			...base,
			operationResultCode: null,
			operationSpecificResultCode: null,
			outcome: null,
			outcomeAvailable: false,
			outcomeEvidence: null
		};
	}
	return {
		...base,
		operationResultCode: operation.operationResultCode,
		operationSpecificResultCode: operation.operationSpecificResultCode,
		outcome: operation.outcome,
		outcomeAvailable: true,
		outcomeEvidence: {
			decoderVersion: operation.outcomeDecoderVersion,
			factScope: operation.outcomeFactScope
		}
	};
}
