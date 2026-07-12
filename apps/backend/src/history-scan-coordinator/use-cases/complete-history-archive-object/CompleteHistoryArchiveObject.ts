import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import {
	isArchiveMetadataDTO,
	type ArchiveMetadataDTO
} from 'history-scanner-dto';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveStateSnapshot } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type {
	HistoryArchiveObject,
	HistoryArchiveObjectVerificationFacts
} from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import {
	buildCheckpointStateDiscoveryObjects,
	buildCheckpointSiblingObjectsFromState,
	checkpointDiscoveryFrontierSize,
	buildHistoryArchiveObjectsFromState
} from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

export interface CompleteHistoryArchiveObjectRequest extends HistoryArchiveObjectProgressUpdate {
	readonly archiveMetadata?: ArchiveMetadataDTO | null;
}

@injectable()
export class CompleteHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveStateRepository)
		private readonly stateRepository: HistoryArchiveStateRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder,
		@inject(TYPES.HistoryArchiveCheckpointProofRepository)
		private readonly checkpointProofRepository: HistoryArchiveCheckpointProofRepository
	) {}

	async execute(
		remoteId: string,
		request: CompleteHistoryArchiveObjectRequest
	): Promise<Result<boolean, Error>> {
		try {
			const object = await this.objectRepository.findByRemoteId(remoteId);
			if (object === null) return ok(false);
			const progress = await this.prepareCompletionProgress(object, request);

			const transitioned = await this.objectRepository.markObjectVerified(
				remoteId,
				progress
			);
			const verifiedObject =
				await this.objectRepository.findByRemoteId(remoteId);
			if (
				verifiedObject === null ||
				(!transitioned &&
					!isAcceptedCompletionReplay(verifiedObject, request.claimAttempt))
			) {
				return ok(false);
			}

			await this.reconcilePersisted(verifiedObject);

			return ok(true);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	async reconcilePersisted(object: HistoryArchiveObject): Promise<void> {
		if (object.status !== 'verified') return;
		if (object.transitionEffectsCompletedAt !== null) return;

		let descendants: readonly HistoryArchiveObject[] = [];
		if (
			object.objectType === 'history-archive-state' &&
			object.completionArchiveMetadata !== null
		) {
			await this.stateRepository.saveAvailable(
				object.archiveUrl,
				object.completionArchiveMetadata,
				'history-scanner'
			);
			descendants = await this.buildObjectsFromArchiveMetadata(
				object.archiveUrl,
				object.completionArchiveMetadata
			);
		}
		if (object.objectType === 'checkpoint-state') {
			await this.objectRepository.materializeCheckpointDependencies(
				object.remoteId
			);
			descendants = await this.buildObjectsFromCheckpointArchiveMetadata(
				object,
				object.verificationFacts
			);
		}
		if (descendants.length > 0) {
			await this.objectRepository.planObjects(descendants);
		}
		await this.objectRepository.promotePlannedObjects();
		if (shouldRefreshCheckpointProof(object)) {
			await this.checkpointProofRepository.refreshForObject(object);
		}
		await this.eventRecorder.recordDurably(object, {
			claimAttempt: object.attempts,
			eventType: 'verified'
		});
		await this.objectRepository.markTransitionEffectsCompleted(
			object.remoteId,
			object.attempts,
			'verified'
		);
	}

	async reconcileCheckpointDependencies(
		object: HistoryArchiveObject
	): Promise<void> {
		if (
			object.objectType !== 'checkpoint-state' ||
			object.status !== 'verified'
		) {
			return;
		}
		if (object.dependenciesMaterializedAt === null) {
			await this.objectRepository.materializeCheckpointDependencies(
				object.remoteId
			);
		}
		await this.checkpointProofRepository.refreshForObject(object);
	}

	private async prepareCompletionProgress(
		object: HistoryArchiveObject,
		request: CompleteHistoryArchiveObjectRequest
	): Promise<HistoryArchiveObjectProgressUpdate> {
		if (object.objectType !== 'checkpoint-state') return request;
		const archiveMetadata = getCheckpointHistoryArchiveStateMetadata(
			request.verificationFacts
		);
		if (archiveMetadata === null) return request;
		const enrichedMetadata = await this.addRootNetworkPassphraseIfMissing(
			object.archiveUrl,
			archiveMetadata
		);

		return {
			...request,
			archiveMetadata: enrichedMetadata,
			verificationFacts: enrichCheckpointFacts(
				request.verificationFacts,
				enrichedMetadata
			)
		};
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

		const oldestScheduledCheckpointLedger =
			oldestCheckpointByArchive.get(archiveUrlIdentity);
		const olderCheckpointObjects =
			oldestScheduledCheckpointLedger === undefined
				? []
				: buildCheckpointStateDiscoveryObjects(snapshot, {
						maxObjects: checkpointDiscoveryFrontierSize,
						oldestScheduledCheckpointLedger
					});

		return [
			...buildHistoryArchiveObjectsFromState(snapshot),
			...olderCheckpointObjects
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

		const siblingObjects = buildCheckpointSiblingObjectsFromState(snapshot, {
			expectedCheckpointLedger: object.checkpointLedger
		});
		if (siblingObjects.length === 0) return [];

		return [
			...siblingObjects,
			...buildCheckpointStateDiscoveryObjects(snapshot, {
				maxObjects: checkpointDiscoveryFrontierSize,
				oldestScheduledCheckpointLedger: object.checkpointLedger
			})
		];
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

function enrichCheckpointFacts(
	facts: HistoryArchiveObjectVerificationFacts | null | undefined,
	archiveMetadata: ArchiveMetadataDTO
): HistoryArchiveObjectVerificationFacts {
	const networkPassphrase = archiveMetadata.stellarHistory.networkPassphrase;
	const checkpointFact = facts?.checkpointHistoryArchiveStateFact;
	return {
		...facts,
		checkpointHistoryArchiveState: archiveMetadata,
		checkpointHistoryArchiveStateFact:
			checkpointFact === undefined || !networkPassphrase
				? checkpointFact
				: { ...checkpointFact, networkPassphrase }
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldRefreshCheckpointProof(object: HistoryArchiveObject): boolean {
	return object.checkpointLedger !== null || object.bucketHash !== null;
}

function isAcceptedCompletionReplay(
	object: HistoryArchiveObject,
	claimAttempt: number
): boolean {
	return object.status === 'verified' && object.attempts === claimAttempt;
}
