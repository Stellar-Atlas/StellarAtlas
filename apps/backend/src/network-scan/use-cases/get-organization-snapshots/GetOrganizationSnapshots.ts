import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetOrganizationSnapshotsDTO } from './GetOrganizationSnapshotsDTO.js';
import { OrganizationSnapShot } from 'shared';
import { OrganizationId } from '../../domain/organization/OrganizationId.js';
import { OrganizationSnapshotMapper } from '../../mappers/OrganizationSnapshotMapper.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { OrganizationSnapShotRepository } from '../../domain/organization/OrganizationSnapShotRepository.js';

@injectable()
export class GetOrganizationSnapshots {
	constructor(
		@inject(NETWORK_TYPES.OrganizationSnapshotRepository)
		private repo: OrganizationSnapShotRepository,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}
	async execute(
		dto: GetOrganizationSnapshotsDTO
	): Promise<Result<OrganizationSnapShot[], Error>> {
		try {
			const organizationIdOrError = OrganizationId.create(
				dto.organizationId,
				dto.organizationId
			);
			if (organizationIdOrError.isErr())
				return err(organizationIdOrError.error);
			const snapshots = await this.repo.findLatestByOrganizationId(
				organizationIdOrError.value,
				dto.at
			);
			return ok(
				snapshots.map((snapshot) =>
					OrganizationSnapshotMapper.toOrganizationSnapshotDTO(snapshot)
				)
			);
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
			return err(mapUnknownToError(error));
		}
	}
}
