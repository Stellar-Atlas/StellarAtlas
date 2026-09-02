import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type Organization from '@network-scan/domain/organization/Organization.js';
import { OrganizationId } from '@network-scan/domain/organization/OrganizationId.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import type { KnownOrganizationDTO } from '../get-known-organizations/GetKnownOrganizationsDTO.js';
import { toKnownOrganizationDTO } from '../get-known-organizations/KnownOrganizationMapper.js';

@injectable()
export class GetKnownOrganization {
	constructor(
		@inject(NETWORK_TYPES.OrganizationRepository)
		private readonly organizationRepository: OrganizationRepository,
		@inject(OrganizationDTOService)
		private readonly organizationDTOService: OrganizationDTOService,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		organizationReference: string
	): Promise<Result<KnownOrganizationDTO | null, Error>> {
		try {
			const organizationIdOrError = OrganizationId.create(
				'',
				organizationReference
			);
			let organization = organizationIdOrError.isOk()
				? await this.organizationRepository.findByOrganizationId(
						organizationIdOrError.value
					)
				: null;

			if (organization === null) {
				const reference = normalizeOrganizationReference(organizationReference);
				const matchingOrganizations = (
					await this.organizationRepository.findAllKnown()
				).filter((candidate) =>
					organizationMatchesReference(candidate, reference)
				);
				if (matchingOrganizations.length !== 1) return ok(null);
				organization = matchingOrganizations[0] ?? null;
			}
			if (organization === null) return ok(null);

			const organizationsOrError =
				await this.organizationDTOService.getOrganizationDTOs(new Date(), [
					organization
				]);

			if (organizationsOrError.isErr()) {
				this.exceptionLogger.captureException(organizationsOrError.error);
				return err(organizationsOrError.error);
			}

			const organizationDto = organizationsOrError.value[0];
			if (organizationDto === undefined) {
				throw new Error(
					`Missing known organization DTO for ${organization.organizationId.value}`
				);
			}

			return ok(toKnownOrganizationDTO(organization, organizationDto));
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function organizationMatchesReference(
	organization: Organization,
	reference: string
): boolean {
	const contact = organization.contactInformation;
	const candidates = [
		organization.organizationId.value,
		organization.homeDomain,
		organization.name,
		organization.url,
		contact.dba,
		contact.officialEmail,
		contact.physicalAddress,
		...organization.validators.value.map((validator) => validator.value)
	];

	return candidates.some((candidate) => {
		if (candidate === null) return false;
		const normalizedCandidate = normalizeOrganizationReference(candidate);
		return (
			normalizedCandidate === reference ||
			organizationNameSlug(normalizedCandidate) === reference
		);
	});
}

function normalizeOrganizationReference(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/+$/, '');
}

function organizationNameSlug(value: string): string {
	return value.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
