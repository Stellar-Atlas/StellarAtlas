import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import { OrganizationSnapShot } from 'shared';
import { GetLatestOrganizationSnapshotsDTO } from './GetLatestOrganizationSnapshotsDTO.js';
import { OrganizationSnapshotMapper } from '../../mappers/OrganizationSnapshotMapper.js';
import type { OrganizationSnapShotRepository } from '../../domain/organization/OrganizationSnapShotRepository.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import 'reflect-metadata';

@injectable()
export class GetLatestOrganizationSnapshots {
	constructor(
		@inject(NETWORK_TYPES.OrganizationSnapshotRepository)
		private repo: OrganizationSnapShotRepository,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}
	async execute(
		dto: GetLatestOrganizationSnapshotsDTO
	): Promise<Result<OrganizationSnapShot[], Error>> {
		try {
			const snapshots = await this.repo.findLatest(dto.at);
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
