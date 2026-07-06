import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import {
	isArchiveMetadataDTO,
	type ArchiveMetadataDTO
} from 'history-scanner-dto';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import { HistoryArchiveStateSnapshot } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import {
	buildCheckpointStateDiscoveryObjects,
	buildCheckpointSiblingObjectsFromState,
	buildHistoryArchiveObjectsFromState
} from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

export interface CompleteHistoryArchiveObjectRequest extends HistoryArchiveObjectProgressUpdate {
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

			if (
				object.objectType === 'history-archive-state' &&
				request.archiveMetadata !== undefined
			) {
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
			if (object.objectType === 'checkpoint-state') {
				await this.objectRepository.saveObjects(
					await this.buildObjectsFromCheckpointArchiveMetadata(
						object,
						request.verificationFacts
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
				const verifiedObject =
					await this.objectRepository.findByRemoteId(remoteId);
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

	private async buildObjectsFromCheckpointArchiveMetadata(
		object: HistoryArchiveObject,
		verificationFacts?: object | null
	) {
		const archiveMetadata =
			getCheckpointHistoryArchiveStateMetadata(verificationFacts);
		if (archiveMetadata === null) return [];
		const metadataWithNetworkPassphrase =
			await this.addRootNetworkPassphraseIfMissing(
				object.archiveUrl,
				archiveMetadata
			);

		const snapshot = HistoryArchiveStateSnapshot.available(
			object.archiveUrl,
			object.archiveUrlIdentity,
			metadataWithNetworkPassphrase,
			'history-scanner'
		);

		return buildCheckpointSiblingObjectsFromState(snapshot, {
			expectedCheckpointLedger: object.checkpointLedger
		});
	}

	private async addRootNetworkPassphraseIfMissing(
		archiveUrl: string,
		archiveMetadata: ArchiveMetadataDTO
	): Promise<ArchiveMetadataDTO> {
		if (archiveMetadata.stellarHistory.networkPassphrase) {
			return archiveMetadata;
		}
		const rootState = await this.stateRepository.findByUrl(archiveUrl);
		if (!rootState?.networkPassphrase) return archiveMetadata;

		return {
			...archiveMetadata,
			stellarHistory: {
				...archiveMetadata.stellarHistory,
				networkPassphrase: rootState.networkPassphrase
			}
		};
	}
}

function getCheckpointHistoryArchiveStateMetadata(
	verificationFacts?: object | null
): ArchiveMetadataDTO | null {
	if (!isRecord(verificationFacts)) return null;
	const value = verificationFacts.checkpointHistoryArchiveState;
	return isArchiveMetadataDTO(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
