import { err, ok, Result } from 'neverthrow';
import { inject, injectable } from 'inversify';
import { OrganizationTomlFetcher } from './OrganizationTomlFetcher.js';
import { OrganizationScan } from './OrganizationScan.js';
import { NodeScan } from '../../node/scan/NodeScan.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { OrganizationRepository } from '../OrganizationRepository.js';
import Organization from '../Organization.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { CouldNotRetrieveArchivedOrganizationsError } from './errors/CouldNotRetrieveArchivedOrganizationsError.js';
import { OrganizationScanError } from './errors/OrganizationScanError.js';
import type { Logger } from '@core/services/Logger.js';

@injectable()
export class OrganizationScanner {
	constructor(
		private organizationTomlFetcher: OrganizationTomlFetcher,
		@inject(NETWORK_TYPES.OrganizationRepository)
		private organizationRepository: OrganizationRepository,
		@inject('Logger')
		private logger: Logger
	) {}

	public async execute(
		organizationScan: OrganizationScan,
		nodeScan: NodeScan
	): Promise<Result<OrganizationScan, OrganizationScanError>> {
		const organizationTomlInfoCollection =
			await this.organizationTomlFetcher.fetchOrganizationTomlInfoCollection(
				nodeScan.getHomeDomains()
			);

		const archivedOrganizationsOrError = await this.getArchivedOrganizations(
			organizationScan.organizations,
			nodeScan.getHomeDomains()
		);
		if (archivedOrganizationsOrError.isErr())
			return err(archivedOrganizationsOrError.error);

		const updateResult = organizationScan.updateWithTomlInfoCollection(
			organizationTomlInfoCollection,
			nodeScan,
			archivedOrganizationsOrError.value
		);

		if (updateResult.isErr()) return err(updateResult.error);
		updateResult.value.forEach((invalidOrganizationTomlInfo) => {
			this.logger.info('Invalid organization toml info', {
				homeDomain: invalidOrganizationTomlInfo.homeDomain,
				errorType: invalidOrganizationTomlInfo.error.name,
				errorMessage: invalidOrganizationTomlInfo.error.message
			});
		});

		organizationScan.calculateOrganizationAvailability(nodeScan);

		const archiveOrganizations =
			organizationScan.archiveOrganizationsWithNoActiveValidators(nodeScan);
		archiveOrganizations.forEach((organization) => {
			this.logger.info('Archived organization', {
				homeDomain: organization.homeDomain
			});
		});

		return ok(organizationScan);
	}

	private async getArchivedOrganizations(
		activeOrganizations: Organization[],
		detectedHomeDomains: string[]
	): Promise<Result<Organization[], OrganizationScanError>> {
		try {
			const archivedHomeDomains = detectedHomeDomains.filter(
				(homeDomain) =>
					!activeOrganizations.find(
						(organization) => organization.homeDomain === homeDomain
					)
			);

			if (archivedHomeDomains.length > 0)
				return ok(
					await this.organizationRepository.findByHomeDomains(
						archivedHomeDomains
					)
				);

			return ok([]);
		} catch (e) {
			return err(
				new CouldNotRetrieveArchivedOrganizationsError(mapUnknownToError(e))
			);
		}
	}
}
