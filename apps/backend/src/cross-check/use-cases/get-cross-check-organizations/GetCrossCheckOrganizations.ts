import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { OrganizationV1 } from 'shared';
import { GetOrganizations } from '@network-scan/use-cases/get-organizations/GetOrganizations.js';
import type {
	CrossCheckOrganizationDTO,
	CrossCheckOrganizationTomlEvidenceStatus,
	CrossCheckOrganizationsDTO
} from '../../domain/CrossCheckOrganization.js';

export interface GetCrossCheckOrganizationsDTO {
	readonly limit?: number;
}

@injectable()
export class GetCrossCheckOrganizations {
	private static readonly defaultLimit = 50;
	static readonly maxLimit = 100;

	constructor(
		@inject(GetOrganizations)
		private readonly getOrganizations: GetOrganizations
	) {}

	async execute(
		dto: GetCrossCheckOrganizationsDTO = {}
	): Promise<Result<CrossCheckOrganizationsDTO, Error>> {
		const organizationsOrError = await this.getOrganizations.execute({});
		if (organizationsOrError.isErr()) return err(organizationsOrError.error);

		const organizations = organizationsOrError.value;
		const limit = this.normalizeLimit(dto.limit);
		const mappedOrganizations = organizations
			.toSorted(compareOrganizations)
			.slice(0, limit)
			.map(mapOrganization);

		return ok({
			generatedAt: new Date().toISOString(),
			limit,
			count: mappedOrganizations.length,
			totalEligibleCount: organizations.length,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection: 'latest_network_snapshot_active_organizations',
			organizations: mappedOrganizations
		});
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined) return GetCrossCheckOrganizations.defaultLimit;

		return Math.min(limit, GetCrossCheckOrganizations.maxLimit);
	}
}

function mapOrganization(
	organization: OrganizationV1
): CrossCheckOrganizationDTO {
	return {
		organizationId: organization.id,
		comparisonStatus: 'not_compared',
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
