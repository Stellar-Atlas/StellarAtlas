import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import { HistoryArchiveStateSnapshot } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import {
	buildCheckpointStateDiscoveryObjects,
	buildHistoryArchiveObjectsFromState
} from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

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
		private readonly stateRepository: HistoryArchiveStateRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder
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
					await this.buildObjectsFromArchiveMetadata(
						object.archiveUrl,
						request.archiveMetadata
					)
				);
			}

			const updated = await this.objectRepository.markObjectVerified(remoteId, {
					bytesDownloaded: request.bytesDownloaded,
					claimAttempt: request.claimAttempt,
					verificationFacts: request.verificationFacts,
					workerStage: request.workerStage
				});
			if (updated) {
				const verifiedObject = await this.objectRepository.findByRemoteId(remoteId);
				if (verifiedObject !== null) {
					await this.eventRecorder.record(verifiedObject, {
						claimAttempt: request.claimAttempt,
						eventType: 'verified'
					});
				}
			}

			return ok(updated);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	private async buildObjectsFromArchiveMetadata(
		archiveUrl: string,
		archiveMetadata: ArchiveMetadataDTO
	) {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) return [];

		const snapshot = HistoryArchiveStateSnapshot.available(
			archiveUrl,
			archiveUrlIdentity,
			archiveMetadata,
			'history-scanner'
		);
		const oldestCheckpointByArchive =
			await this.objectRepository.findOldestCheckpointLedgerByArchiveUrlIdentities(
				[archiveUrlIdentity]
			);

		return [
			...buildHistoryArchiveObjectsFromState(snapshot),
			...buildCheckpointStateDiscoveryObjects(snapshot, {
				oldestScheduledCheckpointLedger:
					oldestCheckpointByArchive.get(archiveUrlIdentity) ?? null
			})
		];
	}
}
