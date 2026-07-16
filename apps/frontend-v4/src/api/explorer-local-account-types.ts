export interface PublicExplorerLocalAccountSigner {
	readonly key: string;
	readonly sponsor: string | null;
	readonly weight: number;
}

export interface PublicExplorerLocalAccountFields {
	readonly accountId: string;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly flags: string;
	readonly highThreshold: number;
	readonly homeDomain: string;
	readonly inflationDestination: string | null;
	readonly lowThreshold: number;
	readonly masterWeight: number;
	readonly mediumThreshold: number;
	readonly sequenceLedger: string | null;
	readonly sequenceNumber: string;
	readonly sequenceTime: string | null;
	readonly signers: readonly PublicExplorerLocalAccountSigner[];
	readonly sellingLiabilities: string;
	readonly sponsoredEntryCount: string;
	readonly sponsoringEntryCount: string;
	readonly subentryCount: string;
}

export interface PublicExplorerLocalAccountCoverageRange {
	readonly batchId: string;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly ledgerCount: number;
}

export type PublicExplorerLocalAccountChangeReason =
	'fee' | 'fee_refund' | 'operation' | 'transaction' | 'upgrade';

export interface PublicExplorerLocalAccountChange {
	readonly accountFields: PublicExplorerLocalAccountFields;
	readonly change: {
		readonly changeType: number;
		readonly changeTypeString: string;
		readonly lastModifiedLedger: string;
		readonly reason: PublicExplorerLocalAccountChangeReason;
		readonly sponsor: string | null;
		readonly transactionHash: string | null;
	};
	readonly coverage: PublicExplorerLocalAccountCoverageRange;
	readonly deleted: boolean;
	readonly freshness: {
		readonly batchProcessedAt: string;
		readonly canonicalCoverageCompletedAt: string;
		readonly canonicalProofEvaluatedAt: string;
		readonly datasetImportedAt: string;
		readonly ledgerClosedAt: string;
	};
	readonly position: {
		readonly changeIndex: string;
		readonly ledgerSequence: string;
		readonly operationIndex: string | null;
		readonly transactionIndex: string;
		readonly upgradeIndex: string | null;
	};
	readonly provenance: {
		readonly batch: { readonly id: string };
		readonly dataset: {
			readonly importedRowSetSha256: string;
			readonly name: 'account-state-changes';
			readonly outputSha256: string;
			readonly recordCount: string;
			readonly schemaVersion: string;
		};
		readonly manifest: { readonly sha256: string };
		readonly proof: {
			readonly canonicalBatchIds: readonly string[];
			readonly minimumVersion: number;
		};
		readonly row: {
			readonly ledgerKeySha256: string;
			readonly sha256: string;
		};
	};
	readonly stateSemantics:
		'observed_post_change_state' | 'final_pre_deletion_state';
}

export interface PublicExplorerLocalAccountLatestCoverage {
	readonly evidenceSelection: 'latest_complete_canonical_lcm_batch';
	readonly freshness: {
		readonly canonicalCoverageCompletedAt: string;
		readonly canonicalProofEvaluatedAt: string;
		readonly latestCoveredLedgerClosedAt: string;
	};
	readonly range: PublicExplorerLocalAccountCoverageRange;
}

interface PublicExplorerLocalAccountChangesBase {
	readonly accountId: string;
	readonly count: number;
	readonly generatedAt: string;
	readonly interpretation: 'historical_observations_not_current_state';
	readonly limit: number;
	readonly records: readonly PublicExplorerLocalAccountChange[];
	readonly source: 'postgres_proof_gated_lcm_account_changes';
	readonly truncated: boolean;
}

export interface PublicExplorerLocalAccountChangesAvailable extends PublicExplorerLocalAccountChangesBase {
	readonly coverage: PublicExplorerLocalAccountLatestCoverage;
	readonly status: 'available';
}

export interface PublicExplorerLocalAccountChangesNotObserved extends PublicExplorerLocalAccountChangesBase {
	readonly coverage: PublicExplorerLocalAccountLatestCoverage;
	readonly reason: 'no_change_observed_in_complete_coverage';
	readonly status: 'not_observed';
}

export interface PublicExplorerLocalAccountChangesUnavailable extends PublicExplorerLocalAccountChangesBase {
	readonly coverage: null;
	readonly reason: 'complete_canonical_coverage_empty';
	readonly status: 'unavailable';
}

export type PublicExplorerLocalAccountChanges =
	| PublicExplorerLocalAccountChangesAvailable
	| PublicExplorerLocalAccountChangesNotObserved
	| PublicExplorerLocalAccountChangesUnavailable;
