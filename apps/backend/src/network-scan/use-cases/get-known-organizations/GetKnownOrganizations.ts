import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import type {
	KnownOrganizationsDTO,
	KnownOrganizationsInventoryDTO,
	KnownOrganizationScopeTotals
} from './GetKnownOrganizationsDTO.js';
import {
	toKnownOrganizationDTO,
	toKnownOrganizationListItemDTO
} from './KnownOrganizationMapper.js';
import {
	defaultKnownOrganizationsRequest,
	type KnownNetworkPageRequest,
	type KnownOrganizationScope
} from '../known-network-scope/KnownNetworkScope.js';

@injectable()
export class GetKnownOrganizations {
	constructor(
		@inject(NETWORK_TYPES.OrganizationRepository)
		private readonly organizationRepository: OrganizationRepository,
		@inject(OrganizationDTOService)
		private readonly organizationDTOService: OrganizationDTOService,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: KnownNetworkPageRequest<KnownOrganizationScope> = defaultKnownOrganizationsRequest
	): Promise<Result<KnownOrganizationsDTO, Error>> {
		const inventoryOrError = await this.executeAll();
		if (inventoryOrError.isErr()) return err(inventoryOrError.error);

		const inventory = inventoryOrError.value;
		const scopedOrganizations =
			request.scope === 'all-known'
				? inventory.organizations
				: inventory.organizations.filter(
						(organization) => organization.scope === request.scope
					);
		const matchingOrganizations = filterKnownOrganizations(
			scopedOrganizations,
			request.query
		);
		const organizations = matchingOrganizations.slice(
			request.offset,
			request.offset + request.limit
		);

		return ok({
			...inventory,
			count: matchingOrganizations.length,
			organizations,
			page: {
				hasMore:
					request.offset + organizations.length < matchingOrganizations.length,
				limit: request.limit,
				offset: request.offset,
				total: matchingOrganizations.length
			},
			scope: request.scope
		});
	}

	async executeAll(): Promise<Result<KnownOrganizationsInventoryDTO, Error>> {
		const generatedAt = new Date();

		try {
			const organizations = await this.organizationRepository.findAllKnown();
			const organizationsOrError =
				await this.organizationDTOService.getOrganizationDTOs(
					generatedAt,
					organizations
				);

			if (organizationsOrError.isErr()) {
				this.exceptionLogger.captureException(organizationsOrError.error);
				return err(organizationsOrError.error);
			}

			const organizationDtosById = new Map(
				organizationsOrError.value.map((organization) => [
					organization.id,
					organization
				])
			);
			const knownOrganizations = organizations.map((organization) => {
				const organizationDto = organizationDtosById.get(
					organization.organizationId.value
				);
				if (organizationDto === undefined) {
					throw new Error(
						`Missing known organization DTO for ${organization.organizationId.value}`
					);
				}
				return toKnownOrganizationListItemDTO(
					toKnownOrganizationDTO(organization, organizationDto)
				);
			});

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: knownOrganizations.length,
				organizations: knownOrganizations,
				scopeTotals: countScopes(knownOrganizations),
				source: 'postgres_canonical'
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function filterKnownOrganizations(
	organizations: KnownOrganizationsInventoryDTO['organizations'],
	query: string
): KnownOrganizationsInventoryDTO['organizations'] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return organizations;
	return organizations.filter(({ organization }) =>
		[
			organization.id,
			organization.name,
			organization.homeDomain,
			organization.url,
			organization.twitter,
			organization.github
		].some((value) => value?.toLowerCase().includes(needle))
	);
}

function countScopes(
	organizations: KnownOrganizationsInventoryDTO['organizations']
): KnownOrganizationScopeTotals {
	const totals: KnownOrganizationScopeTotals = {
		'all-known': organizations.length,
		archived: 0,
		current: 0
	};
	for (const organization of organizations) totals[organization.scope] += 1;
	return totals;
}
