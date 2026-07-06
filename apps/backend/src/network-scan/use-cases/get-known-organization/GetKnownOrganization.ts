import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
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
		organizationIdValue: string
	): Promise<Result<KnownOrganizationDTO | null, Error>> {
		const organizationIdOrError = OrganizationId.create(
			'',
			organizationIdValue
		);
		if (organizationIdOrError.isErr()) return ok(null);

		try {
			const organization =
				await this.organizationRepository.findByOrganizationId(
					organizationIdOrError.value
				);
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
