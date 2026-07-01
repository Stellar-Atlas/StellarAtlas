import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import { GetNodeSnapshotsDTO } from './GetNodeSnapshotsDTO.js';
import { NodeSnapShot } from 'shared';
import PublicKey from '../../domain/node/PublicKey.js';
import { NodeSnapshotMapper } from '../../mappers/NodeSnapshotMapper.js';
import type { NodeSnapShotRepository } from '../../domain/node/NodeSnapShotRepository.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';

@injectable()
export class GetNodeSnapshots {
	constructor(
		@inject(NETWORK_TYPES.NodeSnapshotRepository)
		private repo: NodeSnapShotRepository,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}
	async execute(
		dto: GetNodeSnapshotsDTO
	): Promise<Result<NodeSnapShot[], Error>> {
		try {
			const publicKeyOrError = PublicKey.create(dto.publicKey);
			if (publicKeyOrError.isErr()) {
				return err(publicKeyOrError.error);
			}
			const snapshots = await this.repo.findLatestByPublicKey(
				publicKeyOrError.value,
				dto.at
			);
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
