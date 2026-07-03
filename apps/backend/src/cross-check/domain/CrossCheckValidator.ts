import type { CrossCheckProbeMode } from './CrossCheckSource.js';

export type CrossCheckValidatorComparisonStatus = 'not_compared';

export type CrossCheckValidatorEvidenceSelection =
	'latest_network_snapshot_validator_or_validating_or_active_in_scp';

export type CrossCheckValidatorInclusionReason =
	'active_in_scp' | 'is_validating' | 'is_validator';

export type CrossCheckValidatorEvidenceStatus =
	| 'scp_activity_observed'
	| 'validating_observed'
	| 'validator_identity_observed';

export interface CrossCheckValidatorRadarComparisonDTO {
	readonly comparisonStatus: CrossCheckValidatorComparisonStatus;
	readonly probe: CrossCheckProbeMode;
	readonly sourceId: 'withobsrvr-radar';
}

export interface CrossCheckValidatorEvidenceDTO {
	readonly active: boolean;
	readonly activeInScp: boolean;
	readonly alias: string | null;
	readonly connectivityError: boolean;
	readonly historyArchiveHasError: boolean;
	readonly historyUrl: string | null;
	readonly homeDomain: string | null;
	readonly host: string | null;
	readonly inclusionReasons: readonly CrossCheckValidatorInclusionReason[];
	readonly index: number;
	readonly isFullValidator: boolean;
	readonly isValidating: boolean;
	readonly isValidator: boolean;
	readonly lag: number | null;
	readonly name: string | null;
	readonly organizationId: string | null;
	readonly publicKey: string;
	readonly quorumSetHashKey: string | null;
	readonly stellarCoreVersionBehind: boolean;
	readonly validatorEvidenceStatus: CrossCheckValidatorEvidenceStatus;
	readonly versionStr: string | null;
}

export interface CrossCheckValidatorDTO {
	readonly comparisonStatus: CrossCheckValidatorComparisonStatus;
	readonly publicKey: string;
	readonly radarComparison: CrossCheckValidatorRadarComparisonDTO;
	readonly stellarAtlas: CrossCheckValidatorEvidenceDTO;
}

export interface CrossCheckValidatorsDTO {
	readonly comparisonStatus: CrossCheckValidatorComparisonStatus;
	readonly count: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly probe: CrossCheckProbeMode;
	readonly evidenceSelection: CrossCheckValidatorEvidenceSelection;
	readonly totalEligibleCount: number;
	readonly validators: readonly CrossCheckValidatorDTO[];
}
