export type ExplorerLocalTrustlineChangeReason =
	'fee' | 'fee_refund' | 'operation' | 'transaction' | 'upgrade';

interface ExplorerLocalTrustlineCreditAssetBaseDTO {
	readonly code: string;
	readonly issuer: string;
	readonly liquidityPoolId: null;
}

export interface ExplorerLocalTrustlineAlpha4AssetDTO extends ExplorerLocalTrustlineCreditAssetBaseDTO {
	readonly assetType: 1;
	readonly assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM4';
	readonly kind: 'credit_alphanum4';
}

export interface ExplorerLocalTrustlineAlpha12AssetDTO extends ExplorerLocalTrustlineCreditAssetBaseDTO {
	readonly assetType: 2;
	readonly assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM12';
	readonly kind: 'credit_alphanum12';
}

export interface ExplorerLocalTrustlinePoolShareAssetDTO {
	readonly assetType: 3;
	readonly assetTypeString: 'ASSET_TYPE_POOL_SHARE';
	readonly code: null;
	readonly issuer: null;
	readonly kind: 'liquidity_pool_share';
	readonly liquidityPoolId: string;
}

export type ExplorerLocalTrustlineAssetDTO =
	| ExplorerLocalTrustlineAlpha4AssetDTO
	| ExplorerLocalTrustlineAlpha12AssetDTO
	| ExplorerLocalTrustlinePoolShareAssetDTO;

export interface ExplorerLocalTrustlineFieldsDTO {
	readonly accountId: string;
	readonly asset: ExplorerLocalTrustlineAssetDTO;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly flags: string;
	readonly limit: string;
	readonly liquidityPoolUseCount: string;
	readonly sellingLiabilities: string;
}

export interface ExplorerLocalTrustlineCoverageRangeDTO {
	readonly batchId: string;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly ledgerCount: number;
}

export interface ExplorerLocalTrustlineChangeDTO {
	readonly change: {
		readonly changeType: number;
		readonly changeTypeString: string;
		readonly lastModifiedLedger: string;
		readonly reason: ExplorerLocalTrustlineChangeReason;
		readonly sponsor: string | null;
		readonly transactionHash: string | null;
	};
	readonly coverage: ExplorerLocalTrustlineCoverageRangeDTO;
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
			readonly name: 'trustline-state-changes';
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
	readonly trustlineFields: ExplorerLocalTrustlineFieldsDTO;
}

export interface ExplorerLocalTrustlineLatestCoverageDTO {
	readonly evidenceSelection: 'latest_complete_canonical_lcm_batch';
	readonly freshness: {
		readonly canonicalCoverageCompletedAt: string;
		readonly canonicalProofEvaluatedAt: string;
		readonly latestCoveredLedgerClosedAt: string;
	};
	readonly range: ExplorerLocalTrustlineCoverageRangeDTO;
}

interface ExplorerLocalTrustlineChangesBaseDTO {
	readonly accountId: string;
	readonly count: number;
	readonly generatedAt: string;
	readonly interpretation: 'historical_observations_not_current_state';
	readonly limit: number;
	readonly records: readonly ExplorerLocalTrustlineChangeDTO[];
	readonly source: 'postgres_proof_gated_lcm_trustline_changes';
	readonly truncated: boolean;
}

export interface ExplorerLocalTrustlineChangesAvailableDTO extends ExplorerLocalTrustlineChangesBaseDTO {
	readonly coverage: ExplorerLocalTrustlineLatestCoverageDTO;
	readonly status: 'available';
}

export interface ExplorerLocalTrustlineChangesNotObservedDTO extends ExplorerLocalTrustlineChangesBaseDTO {
	readonly coverage: ExplorerLocalTrustlineLatestCoverageDTO;
	readonly reason: 'no_change_observed_in_complete_coverage';
	readonly status: 'not_observed';
}

export interface ExplorerLocalTrustlineChangesUnavailableDTO extends ExplorerLocalTrustlineChangesBaseDTO {
	readonly coverage: null;
	readonly reason: 'complete_canonical_coverage_empty';
	readonly status: 'unavailable';
}

export type ExplorerLocalTrustlineChangesDTO =
	| ExplorerLocalTrustlineChangesAvailableDTO
	| ExplorerLocalTrustlineChangesNotObservedDTO
	| ExplorerLocalTrustlineChangesUnavailableDTO;
