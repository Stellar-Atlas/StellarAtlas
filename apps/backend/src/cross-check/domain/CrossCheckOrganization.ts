import type { CrossCheckProbeMode } from './CrossCheckSource.js';

export type CrossCheckOrganizationComparisonStatus = 'not_compared';

export type CrossCheckOrganizationEvidenceSelection =
	'latest_network_snapshot_active_organizations';

export type CrossCheckOrganizationEvidenceStatus =
	'organization_snapshot_observed';

export type CrossCheckOrganizationTomlEvidenceStatus =
	'toml_issue_observed' | 'toml_ok' | 'toml_unknown';

export interface CrossCheckOrganizationRadarComparisonDTO {
	readonly comparisonStatus: CrossCheckOrganizationComparisonStatus;
	readonly probe: CrossCheckProbeMode;
	readonly sourceId: 'withobsrvr-radar';
}

export interface CrossCheckOrganizationEvidenceDTO {
	readonly dateDiscovered: string;
	readonly dba: string | null;
	readonly description: string | null;
	readonly github: string | null;
	readonly has24HourStats: boolean;
	readonly has30DayStats: boolean;
	readonly hasReliableUptime: boolean;
	readonly homeDomain: string;
	readonly horizonUrl: string | null;
	readonly id: string;
	readonly keybase: string | null;
	readonly name: string | null;
	readonly officialEmail: string | null;
	readonly organizationEvidenceStatus: CrossCheckOrganizationEvidenceStatus;
	readonly organizationId: string;
	readonly phoneNumber: string | null;
	readonly physicalAddress: string | null;
	readonly subQuorum24HoursAvailability: number;
	readonly subQuorum30DaysAvailability: number;
	readonly subQuorumAvailable: boolean;
	readonly tomlEvidenceStatus: CrossCheckOrganizationTomlEvidenceStatus;
	readonly tomlState: string;
	readonly twitter: string | null;
	readonly url: string | null;
	readonly validatorPublicKeyCount: number;
	readonly validatorPublicKeys: readonly string[];
}

export interface CrossCheckOrganizationDTO {
	readonly comparisonStatus: CrossCheckOrganizationComparisonStatus;
	readonly organizationId: string;
	readonly radarComparison: CrossCheckOrganizationRadarComparisonDTO;
	readonly stellarAtlas: CrossCheckOrganizationEvidenceDTO;
}

export interface CrossCheckOrganizationsDTO {
	readonly comparisonStatus: CrossCheckOrganizationComparisonStatus;
	readonly count: number;
	readonly evidenceSelection: CrossCheckOrganizationEvidenceSelection;
	readonly generatedAt: string;
	readonly limit: number;
	readonly organizations: readonly CrossCheckOrganizationDTO[];
	readonly probe: CrossCheckProbeMode;
	readonly totalEligibleCount: number;
}
