import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Snapshot } from '@core/domain/Snapshot.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type Organization from '@network-scan/domain/organization/Organization.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import type {
	KnownOrganizationDTO,
	KnownOrganizationsDTO
} from './GetKnownOrganizationsDTO.js';

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

	async execute(): Promise<Result<KnownOrganizationsDTO, Error>> {
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
				return toKnownOrganizationDTO(organization, organizationDto);
			});

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: knownOrganizations.length,
				organizations: knownOrganizations
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function toKnownOrganizationDTO(
	organization: Organization,
	organizationDto: KnownOrganizationDTO['organization']
): KnownOrganizationDTO {
	const current = isCurrentSnapshot(organization.snapshotEndDate);
	const lastMeasurementAt =
		organization.latestMeasurement()?.time.toISOString() ?? null;
	const snapshotEndDate = organization.snapshotEndDate.toISOString();

	return {
		organization: organizationDto,
		current,
		snapshotStartDate: organization.snapshotStartDate.toISOString(),
		snapshotEndDate: current ? null : snapshotEndDate,
		lastSeen: lastMeasurementAt ?? (current ? null : snapshotEndDate),
		lastMeasurementAt
	};
}

function isCurrentSnapshot(snapshotEndDate: Date): boolean {
	return snapshotEndDate.getTime() === Snapshot.MAX_DATE.getTime();
}
