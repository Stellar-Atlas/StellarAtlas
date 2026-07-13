interface PublicExplorerOperationBase {
	readonly createdAt: string;
	readonly id: string;
	readonly ledger: string | null;
	readonly sourceAccount: string | null;
	readonly transactionHash: string | null;
	readonly type: string;
}

interface PublicCanonicalExplorerOperationBase extends PublicExplorerOperationBase {
	readonly accountReferences: readonly PublicExplorerOperationAccountReference[];
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
	readonly operationIndex: number;
	readonly source: 'postgres_canonical';
	readonly sourceAccountOrigin: 'operation' | 'transaction';
	readonly transactionIndex: number;
}

export type PublicExplorerOperationAccountReferenceRole =
	| 'claimant'
	| 'clawback_source'
	| 'destination'
	| 'effective_source'
	| 'inflation_destination'
	| 'offer_seller'
	| 'sponsored_account'
	| 'sponsorship_account'
	| 'trustor';

export interface PublicExplorerOperationAccountReference {
	readonly accountId: string;
	readonly baseAccountId: string;
	readonly role: PublicExplorerOperationAccountReferenceRole;
}

interface PublicCanonicalExplorerOperationOutcomeAvailable {
	readonly operationResultCode: -6 | -5 | -4 | -3 | -2 | -1 | 0 | null;
	readonly operationSpecificResultCode: number | null;
	readonly outcome: 'failed' | 'not_applied' | 'succeeded';
	readonly outcomeAvailable: true;
	readonly outcomeEvidence: {
		readonly decoderVersion: string;
		readonly factScope: 'transaction_result_xdr';
	};
}

interface PublicCanonicalExplorerOperationOutcomeUnavailable {
	readonly operationResultCode: null;
	readonly operationSpecificResultCode: null;
	readonly outcome: null;
	readonly outcomeAvailable: false;
	readonly outcomeEvidence: null;
}

export type PublicCanonicalExplorerOperation =
	PublicCanonicalExplorerOperationBase &
		(
			| PublicCanonicalExplorerOperationOutcomeAvailable
			| PublicCanonicalExplorerOperationOutcomeUnavailable
		);

export interface PublicHorizonExplorerOperation extends PublicExplorerOperationBase {
	readonly source: 'horizon';
	readonly successful: boolean | null;
	readonly typeNumber: number | null;
}

export type PublicExplorerOperation =
	PublicCanonicalExplorerOperation | PublicHorizonExplorerOperation;

export interface PublicExplorerOperationFilters {
	readonly accountId?: string;
	readonly firstLedger?: string;
	readonly from?: string;
	readonly ledger?: string;
	readonly lastLedger?: string;
	readonly operationType?: string;
	readonly to?: string;
	readonly transactionHash?: string;
}

export interface PublicExplorerOperations {
	readonly count?: number;
	readonly coverage?: {
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
	readonly factBoundary?: {
		readonly excludes: 'state_effects_soroban_auth_signers_and_asset_issuers';
		readonly includes: 'operation_type_effective_source_and_explicit_envelope_account_references';
		readonly outcomes: 'transaction_result_xdr_when_indexed';
	};
	readonly filters: PublicExplorerOperationFilters;
	readonly generatedAt?: string;
	readonly limit?: number;
	readonly records: readonly PublicExplorerOperation[];
	readonly source: 'horizon' | 'postgres_canonical';
	readonly truncated: boolean;
}
