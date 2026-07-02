import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetLatestNodeSnapshotsDTO } from './GetLatestNodeSnapshotsDTO.js';
import { NodeSnapShot } from 'shared';
import { NodeSnapshotMapper } from '../../mappers/NodeSnapshotMapper.js';
import type { NodeSnapShotRepository } from '../../domain/node/NodeSnapShotRepository.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import 'reflect-metadata';

@injectable()
export class GetLatestNodeSnapshots {
	constructor(
		@inject(NETWORK_TYPES.NodeSnapshotRepository)
		private repo: NodeSnapShotRepository,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}
	async execute(
		dto: GetLatestNodeSnapshotsDTO
	): Promise<Result<NodeSnapShot[], Error>> {
		try {
			const snapshots = await this.repo.findLatest(dto.at);
			return ok(
				snapshots.map((snapshot) =>
					NodeSnapshotMapper.toNodeSnapshotDTO(snapshot)
				)
			);
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
			return err(mapUnknownToError(error));
		}
	}
}
