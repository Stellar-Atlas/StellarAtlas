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
	buildCheckpointSiblingObjectsFromState,
	buildHistoryArchiveObjectsFromState
} from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

const immediateProofRefreshBatchSize = 10;

export interface CompleteHistoryArchiveObjectRequest extends HistoryArchiveObjectProgressUpdate {
	readonly archiveMetadata?: ArchiveMetadataDTO | null;
}

export interface CompleteHistoryArchiveObjectReconciliationOptions {
	readonly promotePlannedObjects?: boolean;
}

@injectable()
export class CompleteHistoryArchiveObject {
	private proofCompletionEventRequested = false;
	private proofCompletionEventRunning = false;

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

			return ok(true);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	async executeAndReconcile(
		remoteId: string,
		request: CompleteHistoryArchiveObjectRequest
	): Promise<Result<boolean, Error>> {
		const result = await this.execute(remoteId, request);
		if (result.isErr() || !result.value) return result;

		try {
			await this.reconcileClaimAttempt(remoteId, request.claimAttempt);
			return result;
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async reconcileClaimAttempt(
		remoteId: string,
		claimAttempt: number,
		options: CompleteHistoryArchiveObjectReconciliationOptions = {}
	): Promise<void> {
		await this.objectRepository.withTransitionEffectsLock(
			remoteId,
			claimAttempt,
			async () => {
				const persisted = await this.objectRepository.findByRemoteId(remoteId);
				if (
					persisted === null ||
					persisted.status !== 'verified' ||
					persisted.attempts !== claimAttempt
				) {
					return;
				}
				await this.reconcilePersisted(persisted, options);
			}
		);
	}

	async reconcilePersisted(
		object: HistoryArchiveObject,
		options: CompleteHistoryArchiveObjectReconciliationOptions = {}
	): Promise<void> {
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
			await this.reconcileCheckpointFanout(object);
		}
		if (descendants.length > 0) {
			await this.objectRepository.planObjects(descendants);
		}
		if (options.promotePlannedObjects !== false) {
			await this.objectRepository.promotePlannedObjects();
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
		this.requestProofCompletionEvent(object);
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
		const persisted = await this.objectRepository.findByRemoteId(
			object.remoteId
		);
		if (
			persisted === null ||
			persisted.objectType !== 'checkpoint-state' ||
			persisted.status !== 'verified' ||
			(persisted.transitionEffectsRequiredAt !== null &&
				persisted.transitionEffectsCompletedAt === null)
		) {
			return;
		}
		if (persisted.dependenciesMaterializedAt === null) {
			await this.objectRepository.materializeCheckpointDependencies(
				persisted.remoteId
			);
		}
		await this.checkpointProofRepository.refreshForObject(persisted);
	}

	async reconcileCheckpointFanout(object: HistoryArchiveObject): Promise<void> {
		if (
			object.objectType !== 'checkpoint-state' ||
			object.status !== 'verified' ||
			object.descendantsPlannedAt !== null
		) {
			return;
		}
		const descendants = await this.buildObjectsFromCheckpointArchiveMetadata(
			object,
			object.verificationFacts
		);
		if (descendants.length === 0) return;
		await this.objectRepository.planObjects(descendants);
		await this.objectRepository.markCheckpointDescendantsPlanned(
			object.remoteId
		);
	}

	private requestProofCompletionEvent(object: HistoryArchiveObject): void {
		if (
			object.objectType !== 'ledger' &&
			object.objectType !== 'transactions' &&
			object.objectType !== 'results' &&
			object.objectType !== 'scp' &&
			object.objectType !== 'bucket'
		) {
			return;
		}
		this.proofCompletionEventRequested = true;
		if (this.proofCompletionEventRunning) return;
		this.proofCompletionEventRunning = true;
		setImmediate(() => {
			void this.drainProofCompletionEvents();
		});
	}

	private async drainProofCompletionEvents(): Promise<void> {
		try {
			let proofQueueMayHaveMore = false;
			do {
				this.proofCompletionEventRequested = false;
				proofQueueMayHaveMore = false;
				try {
					const refresh =
						await this.objectRepository.drainCheckpointProofRefreshQueue(
							immediateProofRefreshBatchSize,
							1
						);
					proofQueueMayHaveMore =
						refresh.claimed === immediateProofRefreshBatchSize;
					if (refresh.completed === 0) continue;
					await this.objectRepository.reconcileExecutionDisposition({
						admitGenericObjects: false
					});
					await this.objectRepository.promotePlannedObjects();
				} catch {
					continue;
				}
			} while (this.proofCompletionEventRequested || proofQueueMayHaveMore);
		} finally {
			this.proofCompletionEventRunning = false;
			if (this.proofCompletionEventRequested) {
				this.proofCompletionEventRunning = true;
				setImmediate(() => {
					void this.drainProofCompletionEvents();
				});
			}
		}
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
		return buildHistoryArchiveObjectsFromState(snapshot, {
			rootStatus: 'verified'
		});
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

		return siblingObjects;
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

function isAcceptedCompletionReplay(
	object: HistoryArchiveObject,
	claimAttempt: number
): boolean {
	return object.status === 'verified' && object.attempts === claimAttempt;
}
