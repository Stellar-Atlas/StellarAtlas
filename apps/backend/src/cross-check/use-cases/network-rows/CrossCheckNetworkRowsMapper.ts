import type { NodeV1, OrganizationV1 } from 'shared';
import type {
	CrossCheckOrganizationDTO,
	CrossCheckOrganizationTomlEvidenceStatus,
	CrossCheckOrganizationsDTO
} from '../../domain/CrossCheckOrganization.js';
import type {
	CrossCheckValidatorDTO,
	CrossCheckValidatorEvidenceStatus,
	CrossCheckValidatorInclusionReason,
	CrossCheckValidatorsDTO
} from '../../domain/CrossCheckValidator.js';
import type { CrossCheckStellarAtlasNetworkRowsDTO } from '../../domain/CrossCheckRadarNetworkComparison.js';

export function mapCrossCheckNetworkRows(dto: {
	readonly generatedAt: string;
	readonly organizations: readonly OrganizationV1[];
	readonly validators: readonly NodeV1[];
}): CrossCheckStellarAtlasNetworkRowsDTO {
	return {
		organizations: mapCrossCheckOrganizations({
			generatedAt: dto.generatedAt,
			limit: dto.organizations.length,
			organizations: dto.organizations
		}),
		validators: mapCrossCheckValidators({
			generatedAt: dto.generatedAt,
			limit: dto.validators.filter(isValidatorLikeNode).length,
			nodes: dto.validators
		})
	};
}

export function mapCrossCheckValidators(dto: {
	readonly generatedAt: string;
	readonly limit: number;
	readonly nodes: readonly NodeV1[];
}): CrossCheckValidatorsDTO {
	const validators = dto.nodes.filter(isValidatorLikeNode);
	const mappedValidators = validators.slice(0, dto.limit).map(mapValidatorNode);

	return {
		comparisonStatus: 'not_compared',
		count: mappedValidators.length,
		evidenceSelection:
			'latest_network_snapshot_validator_or_validating_or_active_in_scp',
		generatedAt: dto.generatedAt,
		limit: dto.limit,
		probe: 'not_run',
		totalEligibleCount: validators.length,
		validators: mappedValidators
	};
}

export function mapCrossCheckOrganizations(dto: {
	readonly generatedAt: string;
	readonly limit: number;
	readonly organizations: readonly OrganizationV1[];
}): CrossCheckOrganizationsDTO {
	const mappedOrganizations = dto.organizations
		.toSorted(compareOrganizations)
		.slice(0, dto.limit)
		.map(mapOrganization);

	return {
		comparisonStatus: 'not_compared',
		count: mappedOrganizations.length,
		evidenceSelection: 'latest_network_snapshot_active_organizations',
		generatedAt: dto.generatedAt,
		limit: dto.limit,
		organizations: mappedOrganizations,
		probe: 'not_run',
		totalEligibleCount: dto.organizations.length
	};
}

export function isValidatorLikeNode(node: NodeV1): boolean {
	return node.isValidator || node.isValidating || node.activeInScp;
}

function mapValidatorNode(node: NodeV1): CrossCheckValidatorDTO {
	return {
		comparisonStatus: 'not_compared',
		publicKey: node.publicKey,
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas: {
			active: node.active,
			activeInScp: node.activeInScp,
			alias: node.alias,
			connectivityError: node.connectivityError,
			historyArchiveHasError: node.historyArchiveHasError,
			historyUrl: node.historyUrl,
			homeDomain: node.homeDomain,
			host: node.host,
			inclusionReasons: getInclusionReasons(node),
			index: node.index,
			isFullValidator: node.isFullValidator,
			isValidating: node.isValidating,
			isValidator: node.isValidator,
			lag: node.lag,
			name: node.name,
			organizationId: node.organizationId,
			publicKey: node.publicKey,
			quorumSetHashKey: node.quorumSetHashKey,
			stellarCoreVersionBehind: node.stellarCoreVersionBehind,
			validatorEvidenceStatus: getValidatorEvidenceStatus(node),
			versionStr: node.versionStr
		}
	};
}

function mapOrganization(
	organization: OrganizationV1
): CrossCheckOrganizationDTO {
	return {
		comparisonStatus: 'not_compared',
		organizationId: organization.id,
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas: {
			dateDiscovered: organization.dateDiscovered,
			dba: organization.dba,
			description: organization.description,
			github: organization.github,
			has24HourStats: organization.has24HourStats,
			has30DayStats: organization.has30DayStats,
			hasReliableUptime: organization.hasReliableUptime,
			homeDomain: organization.homeDomain,
			horizonUrl: organization.horizonUrl,
			id: organization.id,
			keybase: organization.keybase,
			name: organization.name,
			officialEmail: organization.officialEmail,
			organizationEvidenceStatus: 'organization_snapshot_observed',
			organizationId: organization.id,
			phoneNumber: organization.phoneNumber,
			physicalAddress: organization.physicalAddress,
			subQuorum24HoursAvailability: organization.subQuorum24HoursAvailability,
			subQuorum30DaysAvailability: organization.subQuorum30DaysAvailability,
			subQuorumAvailable: organization.subQuorumAvailable,
			tomlEvidenceStatus: getTomlEvidenceStatus(organization.tomlState),
			tomlState: organization.tomlState,
			twitter: organization.twitter,
			url: organization.url,
			validatorPublicKeyCount: organization.validators.length,
			validatorPublicKeys: [...organization.validators]
		}
	};
}

function compareOrganizations(left: OrganizationV1, right: OrganizationV1) {
	const leftKey = getOrganizationSortKey(left);
	const rightKey = getOrganizationSortKey(right);
	if (leftKey < rightKey) return -1;
	if (leftKey > rightKey) return 1;
	return 0;
}

function getOrganizationSortKey(organization: OrganizationV1): string {
	return (organization.name ?? organization.homeDomain ?? organization.id)
		.trim()
		.toLowerCase();
}

function getTomlEvidenceStatus(
	tomlState: string
): CrossCheckOrganizationTomlEvidenceStatus {
	if (tomlState === 'Ok') return 'toml_ok';
	if (tomlState === 'Unknown') return 'toml_unknown';

	return 'toml_issue_observed';
}

function getValidatorEvidenceStatus(
	node: NodeV1
): CrossCheckValidatorEvidenceStatus {
	if (node.isValidating) return 'validating_observed';
	if (node.isValidator) return 'validator_identity_observed';
	return 'scp_activity_observed';
}

function getInclusionReasons(
	node: NodeV1
): readonly CrossCheckValidatorInclusionReason[] {
	const reasons: CrossCheckValidatorInclusionReason[] = [];
	if (node.isValidator) reasons.push('is_validator');
	if (node.isValidating) reasons.push('is_validating');
	if (node.activeInScp) reasons.push('active_in_scp');

	return reasons;
}
