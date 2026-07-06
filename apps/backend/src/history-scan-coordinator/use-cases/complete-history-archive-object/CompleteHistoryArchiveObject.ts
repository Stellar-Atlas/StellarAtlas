import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import { HistoryArchiveStateSnapshot } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { buildHistoryArchiveObjectsFromState } from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

export interface CompleteHistoryArchiveObjectRequest
	extends HistoryArchiveObjectProgressUpdate {
	readonly archiveMetadata?: ArchiveMetadataDTO;
}

@injectable()
export class CompleteHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveStateRepository)
		private readonly stateRepository: HistoryArchiveStateRepository
	) {}

	async execute(
		remoteId: string,
		request: CompleteHistoryArchiveObjectRequest
	): Promise<Result<boolean, Error>> {
		try {
			const object = await this.objectRepository.findByRemoteId(remoteId);
			if (object === null) return ok(false);

			if (request.archiveMetadata !== undefined) {
				await this.stateRepository.saveAvailable(
					object.archiveUrl,
					request.archiveMetadata,
					'history-scanner'
				);
				await this.objectRepository.saveObjects(
					this.buildObjectsFromArchiveMetadata(
						object.archiveUrl,
						request.archiveMetadata
					)
				);
			}

			return ok(
				await this.objectRepository.markObjectVerified(remoteId, {
					bytesDownloaded: request.bytesDownloaded,
					claimAttempt: request.claimAttempt,
					workerStage: request.workerStage
				})
			);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	private buildObjectsFromArchiveMetadata(
		archiveUrl: string,
		archiveMetadata: ArchiveMetadataDTO
	) {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) return [];

		return buildHistoryArchiveObjectsFromState(
			HistoryArchiveStateSnapshot.available(
				archiveUrl,
				archiveUrlIdentity,
				archiveMetadata,
				'history-scanner'
			)
		);
	}
}
