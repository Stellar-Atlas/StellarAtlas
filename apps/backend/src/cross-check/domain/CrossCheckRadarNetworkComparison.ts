import type {
	CrossCheckOrganizationEvidenceDTO,
	CrossCheckOrganizationsDTO
} from './CrossCheckOrganization.js';
import type {
	CrossCheckValidatorEvidenceDTO,
	CrossCheckValidatorsDTO
} from './CrossCheckValidator.js';
import type {
	RadarNetworkNodeDTO,
	RadarNetworkOrganizationDTO
} from './RadarNetworkSnapshot.js';

export type CrossCheckRadarNetworkComparisonStatus =
	'field_mismatch' | 'matched' | 'source_missing' | 'stellaratlas_missing';

export type CrossCheckRadarNetworkEntityType = 'organization' | 'validator';

export type CrossCheckRadarNetworkField =
	| 'active'
	| 'activeInScp'
	| 'alias'
	| 'connectivityError'
	| 'historyArchiveHasError'
	| 'historyUrl'
	| 'homeDomain'
	| 'host'
	| 'horizonUrl'
	| 'isFullValidator'
	| 'isValidating'
	| 'isValidator'
	| 'lag'
	| 'name'
	| 'organizationId'
	| 'quorumSetHashKey'
	| 'stellarCoreVersionBehind'
	| 'tomlState'
	| 'url'
	| 'validators'
	| 'versionStr';

export type CrossCheckRadarNetworkFieldValue =
	readonly string[] | boolean | number | string | null;

export interface CrossCheckRadarNetworkFieldMismatchDTO {
	readonly field: CrossCheckRadarNetworkField;
	readonly sourceValue: CrossCheckRadarNetworkFieldValue;
	readonly stellarAtlasValue: CrossCheckRadarNetworkFieldValue;
}

export interface CrossCheckRadarNetworkRecordComparisonDTO {
	readonly comparisonStatus: CrossCheckRadarNetworkComparisonStatus;
	readonly entityType: CrossCheckRadarNetworkEntityType;
	readonly fieldMismatches: readonly CrossCheckRadarNetworkFieldMismatchDTO[];
	readonly key: string;
	readonly source: RadarNetworkNodeDTO | RadarNetworkOrganizationDTO | null;
	readonly stellarAtlas:
		CrossCheckOrganizationEvidenceDTO | CrossCheckValidatorEvidenceDTO | null;
}

export interface CrossCheckRadarNetworkSnapshotMetadataDTO {
	readonly observedAt: string;
	readonly organizationCount: number;
	readonly sourceId: 'stellaratlas-api' | 'withobsrvr-radar';
	readonly validatorCount: number;
}

export interface CrossCheckRadarNetworkSourceMetadataDTO extends CrossCheckRadarNetworkSnapshotMetadataDTO {
	readonly endpointUrl: string;
	readonly latestLedger: string | null;
	readonly networkId: string | null;
	readonly networkName: string | null;
	readonly networkTime: string | null;
	readonly warnings: readonly string[];
}

export interface CrossCheckRadarNetworkComparisonSummaryDTO {
	readonly fieldMismatchCount: number;
	readonly matchedCount: number;
	readonly organizationCount: number;
	readonly sourceMissingCount: number;
	readonly stellarAtlasMissingCount: number;
	readonly totalCount: number;
	readonly validatorCount: number;
}

export interface CrossCheckRadarNetworkComparisonDTO {
	readonly comparisonStatus: 'compared';
	readonly generatedAt: string;
	readonly organizations: readonly CrossCheckRadarNetworkRecordComparisonDTO[];
	readonly source: CrossCheckRadarNetworkSourceMetadataDTO;
	readonly stellarAtlas: CrossCheckRadarNetworkSnapshotMetadataDTO;
	readonly summary: CrossCheckRadarNetworkComparisonSummaryDTO;
	readonly validators: readonly CrossCheckRadarNetworkRecordComparisonDTO[];
	readonly warnings: readonly string[];
}

export interface CrossCheckStellarAtlasNetworkRowsDTO {
	readonly organizations: CrossCheckOrganizationsDTO;
	readonly validators: CrossCheckValidatorsDTO;
}
