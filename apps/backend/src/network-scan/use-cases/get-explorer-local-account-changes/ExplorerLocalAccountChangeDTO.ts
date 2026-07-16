export interface ExplorerLocalAccountSignerDTO {
	readonly key: string;
	readonly sponsor: string | null;
	readonly weight: number;
}

export interface ExplorerLocalAccountFieldsDTO {
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
	readonly signers: readonly ExplorerLocalAccountSignerDTO[];
	readonly sellingLiabilities: string;
	readonly sponsoredEntryCount: string;
	readonly sponsoringEntryCount: string;
	readonly subentryCount: string;
}

export interface ExplorerLocalAccountCoverageRangeDTO {
	readonly batchId: string;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly ledgerCount: number;
}

export type ExplorerLocalAccountChangeReason =
	'fee' | 'fee_refund' | 'operation' | 'transaction' | 'upgrade';

export interface ExplorerLocalAccountChangeDTO {
	readonly accountFields: ExplorerLocalAccountFieldsDTO;
	readonly change: {
		readonly changeType: number;
		readonly changeTypeString: string;
		readonly lastModifiedLedger: string;
		readonly reason: ExplorerLocalAccountChangeReason;
		readonly sponsor: string | null;
		readonly transactionHash: string | null;
	};
	readonly coverage: ExplorerLocalAccountCoverageRangeDTO;
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
}

export interface ExplorerLocalAccountLatestCoverageDTO {
	readonly evidenceSelection: 'latest_complete_canonical_lcm_batch';
	readonly freshness: {
		readonly canonicalCoverageCompletedAt: string;
		readonly canonicalProofEvaluatedAt: string;
		readonly latestCoveredLedgerClosedAt: string;
	};
	readonly range: ExplorerLocalAccountCoverageRangeDTO;
}

interface ExplorerLocalAccountChangesBaseDTO {
	readonly accountId: string;
	readonly count: number;
	readonly generatedAt: string;
	readonly interpretation: 'historical_observations_not_current_state';
	readonly limit: number;
	readonly records: readonly ExplorerLocalAccountChangeDTO[];
	readonly source: 'postgres_proof_gated_lcm_account_changes';
	readonly truncated: boolean;
}

export interface ExplorerLocalAccountChangesAvailableDTO extends ExplorerLocalAccountChangesBaseDTO {
	readonly coverage: ExplorerLocalAccountLatestCoverageDTO;
	readonly status: 'available';
}

export interface ExplorerLocalAccountChangesNotObservedDTO extends ExplorerLocalAccountChangesBaseDTO {
	readonly coverage: ExplorerLocalAccountLatestCoverageDTO;
	readonly reason: 'no_change_observed_in_complete_coverage';
	readonly status: 'not_observed';
}

export interface ExplorerLocalAccountChangesUnavailableDTO extends ExplorerLocalAccountChangesBaseDTO {
	readonly coverage: null;
	readonly reason: 'complete_canonical_coverage_empty';
	readonly status: 'unavailable';
}

export type ExplorerLocalAccountChangesDTO =
	| ExplorerLocalAccountChangesAvailableDTO
	| ExplorerLocalAccountChangesNotObservedDTO
	| ExplorerLocalAccountChangesUnavailableDTO;
