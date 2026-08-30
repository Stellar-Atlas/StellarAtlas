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
import { notifyHistoryArchiveProofRefreshReady } from '../../infrastructure/ipc/HistoryArchiveProofRefreshWake.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { historyArchiveCompletionWriteConfigFromEnv } from '../reconcile-history-archive-object-transitions/HistoryArchiveMaintenanceConfig.js';

export interface CompleteHistoryArchiveObjectRequest extends HistoryArchiveObjectProgressUpdate {
	readonly archiveMetadata?: ArchiveMetadataDTO | null;
}

export interface CompleteHistoryArchiveObjectReconciliationOptions {
	readonly promotePlannedObjects?: boolean;
}
interface CheckpointFanoutWaiter {
	readonly resolve: () => void;
	readonly reject: (reason?: unknown) => void;
}

interface PendingCheckpointFanout {
	readonly object: HistoryArchiveObject;
	promotePlannedObjects: boolean;
	readonly waiters: CheckpointFanoutWaiter[];
}

interface PendingObjectCompletion {
	readonly remoteId: string;
	readonly request: CompleteHistoryArchiveObjectRequest;
	readonly resolve: (result: Result<boolean, Error>) => void;
}

@injectable()
export class CompleteHistoryArchiveObject {
	private readonly pendingCheckpointFanouts = new Map<
		string,
		PendingCheckpointFanout
	>();
	private checkpointFanoutEventRunning = false;
	private readonly pendingObjectCompletions: PendingObjectCompletion[] = [];
	private objectCompletionEventScheduled = false;
	private objectCompletionEventsRunning = 0;
	private readonly objectCompletionWriteConfig =
		historyArchiveCompletionWriteConfigFromEnv();
	private readonly pendingProofCompletionRemoteIds = new Set<string>();
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
		return await new Promise((resolve) => {
			this.pendingObjectCompletions.push({
				remoteId,
				request,
				resolve
			});
			this.scheduleObjectCompletionEvent();
		});
	}

	private scheduleObjectCompletionEvent(): void {
		if (
			this.objectCompletionEventScheduled ||
			this.objectCompletionEventsRunning >=
				this.objectCompletionWriteConfig.concurrency
		) {
			return;
		}
		this.objectCompletionEventScheduled = true;
		const delayMs =
			this.pendingObjectCompletions.length >=
			this.objectCompletionWriteConfig.batchSize
				? 0
				: this.objectCompletionWriteConfig.batchDelayMs;
		setTimeout(() => {
			this.objectCompletionEventScheduled = false;
			void this.drainObjectCompletionEvents();
		}, delayMs);
	}

	private async drainObjectCompletionEvents(): Promise<void> {
		if (
			this.objectCompletionEventsRunning >=
				this.objectCompletionWriteConfig.concurrency ||
			this.pendingObjectCompletions.length === 0
		) {
			return;
		}
		const batch = this.pendingObjectCompletions.splice(
			0,
			this.objectCompletionWriteConfig.batchSize
		);
		this.objectCompletionEventsRunning++;
		if (this.pendingObjectCompletions.length > 0) {
			this.scheduleObjectCompletionEvent();
		}
		try {
			let results: readonly Result<boolean, Error>[];
			try {
				results = await this.processObjectCompletionBatch(batch);
			} catch (error) {
				const failure = err<boolean, Error>(mapUnknownToError(error));
				results = batch.map(() => failure);
			}
			for (let index = 0; index < batch.length; index++) {
				batch[index]!.resolve(results[index] ?? ok(false));
			}
		} finally {
			this.objectCompletionEventsRunning--;
			if (this.pendingObjectCompletions.length > 0) {
				this.scheduleObjectCompletionEvent();
			}
		}
	}

	private async processObjectCompletionBatch(
		batch: readonly PendingObjectCompletion[]
	): Promise<readonly Result<boolean, Error>[]> {
		const remoteIds = [...new Set(batch.map((item) => item.remoteId))];
		const objects = await this.objectRepository.findByRemoteIds(remoteIds);
		const objectsByRemoteId = new Map(
			objects.map((object) => [object.remoteId, object])
		);
		const results = batch.map((): Result<boolean, Error> => ok(false));
		const prepared: {
			readonly index: number;
			readonly progress: HistoryArchiveObjectProgressUpdate;
			readonly remoteId: string;
		}[] = [];

		for (let index = 0; index < batch.length; index++) {
			const item = batch[index]!;
			const object = objectsByRemoteId.get(item.remoteId);
			if (object === undefined) continue;
			try {
				prepared.push({
					index,
					progress: await this.prepareCompletionProgress(object, item.request),
					remoteId: item.remoteId
				});
			} catch (error) {
				results[index] = err(mapUnknownToError(error));
			}
		}
		if (prepared.length === 0) return results;

		try {
			const verified = await this.objectRepository.markObjectsVerified(
				prepared.map(({ progress, remoteId }) => ({
					progress,
					remoteId
				}))
			);
			const refreshRemoteIds = prepared
				.filter((item) => {
					const object = objectsByRemoteId.get(item.remoteId);
					return (
						!verified.has(item.remoteId) ||
						object?.objectType === 'checkpoint-state'
					);
				})
				.map((item) => item.remoteId);
			const refreshed =
				refreshRemoteIds.length === 0
					? []
					: await this.objectRepository.findByRemoteIds(refreshRemoteIds);
			const refreshedByRemoteId = new Map(
				refreshed.map((object) => [object.remoteId, object])
			);
			const checkpointFanouts: HistoryArchiveObject[] = [];
			for (const item of prepared) {
				const object =
					refreshedByRemoteId.get(item.remoteId) ??
					objectsByRemoteId.get(item.remoteId);
				const claimAttempt = batch[item.index]!.request.claimAttempt;
				const acceptedReplay =
					object !== undefined &&
					isAcceptedCompletionReplay(object, claimAttempt);
				const superseded =
					object !== undefined && object.attempts > claimAttempt;
				const accepted =
					verified.has(item.remoteId) || acceptedReplay || superseded;
				results[item.index] = ok(accepted);
				if (
					(verified.has(item.remoteId) || acceptedReplay) &&
					object !== undefined
				) {
					this.requestProofCompletionEvent(object);
					if (object.objectType === 'checkpoint-state') {
						checkpointFanouts.push(object);
					}
				}
			}
			if (checkpointFanouts.length > 0) {
				notifyHistoryArchiveProofRefreshReady();
			}
		} catch (error) {
			const failure = err<boolean, Error>(mapUnknownToError(error));
			for (const item of prepared) {
				results[item.index] = failure;
			}
		}
		return results;
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
		let createdPlans = false;
		if (descendants.length > 0) {
			await this.objectRepository.planObjects(descendants);
			createdPlans = true;
		}
		if (createdPlans && options.promotePlannedObjects !== false) {
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
		if (object.objectType === 'checkpoint-state') {
			await this.requestCheckpointFanoutEvent(
				object,
				options.promotePlannedObjects !== false
			);
		}
	}

	async reconcileVerifiedTransitionBatch(
		objects: readonly HistoryArchiveObject[],
		options: CompleteHistoryArchiveObjectReconciliationOptions = {}
	): Promise<void> {
		const unique = [
			...new Map(
				objects
					.filter(
						(object) =>
							object.status === 'verified' &&
							object.transitionEffectsCompletedAt === null
					)
					.map((object) => [`${object.remoteId}:${object.attempts}`, object])
			).values()
		];
		const batched = unique.filter(
			(object) => object.objectType !== 'history-archive-state'
		);
		if (batched.length > 0) {
			await this.eventRecorder.recordDurablyBatch(
				batched.map((object) => ({
					object,
					options: {
						claimAttempt: object.attempts,
						eventType: 'verified'
					}
				}))
			);
			const completed =
				await this.objectRepository.markTransitionEffectsCompletedBatch(
					batched.map((object) => ({
						claimAttempt: object.attempts,
						remoteId: object.remoteId,
						status: 'verified'
					}))
				);
			const completedObjects = batched.filter((object) =>
				completed.has(object.remoteId)
			);
			for (const object of completedObjects) {
				this.requestProofCompletionEvent(object);
			}
			const completedCheckpoints = completedObjects.filter(
				(object) => object.objectType === 'checkpoint-state'
			);
			if (completedCheckpoints.length > 0) {
				await Promise.all(
					completedCheckpoints.map((object) =>
						this.requestCheckpointFanoutEvent(
							object,
							options.promotePlannedObjects !== false
						)
					)
				);
			}
		}

		for (const object of unique) {
			if (object.objectType !== 'history-archive-state') continue;
			await this.reconcileClaimAttempt(
				object.remoteId,
				object.attempts,
				options
			);
		}
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
	async reconcileCheckpointDependencyBatch(
		objects: readonly HistoryArchiveObject[]
	): Promise<number> {
		const remoteIds = [
			...new Set(
				objects
					.filter(
						(object) =>
							object.objectType === 'checkpoint-state' &&
							object.status === 'verified'
					)
					.map((object) => object.remoteId)
			)
		];
		if (remoteIds.length === 0) return 0;

		const persisted = (
			await this.objectRepository.findByRemoteIds(remoteIds)
		).filter(
			(object) =>
				object.objectType === 'checkpoint-state' &&
				object.status === 'verified' &&
				(object.transitionEffectsRequiredAt === null ||
					object.transitionEffectsCompletedAt !== null)
		);
		if (persisted.length === 0) return 0;

		const dependenciesPending = persisted
			.filter((object) => object.dependenciesMaterializedAt === null)
			.map((object) => object.remoteId);
		if (dependenciesPending.length > 0) {
			await this.objectRepository.materializeCheckpointDependencyBatch(
				dependenciesPending
			);
		}
		await this.objectRepository.enqueueCheckpointProofRefreshes(
			persisted.map((object) => object.remoteId)
		);
		return persisted.length;
	}

	async reconcileCheckpointFanouts(
		objects: readonly HistoryArchiveObject[]
	): Promise<number> {
		const eligible = objects.filter(
			(object) =>
				object.objectType === 'checkpoint-state' &&
				object.status === 'verified' &&
				object.descendantsPlannedAt === null
		);
		if (eligible.length === 0) return 0;
		await Promise.all(
			eligible.map((object) => this.requestCheckpointFanoutEvent(object, true))
		);
		return eligible.length;
	}

	async reconcileCheckpointFanout(
		object: HistoryArchiveObject
	): Promise<boolean> {
		if (
			object.objectType !== 'checkpoint-state' ||
			object.status !== 'verified' ||
			object.descendantsPlannedAt !== null
		) {
			return false;
		}
		const descendants = await this.buildObjectsFromCheckpointArchiveMetadata(
			object,
			object.verificationFacts
		);
		if (descendants.length === 0) return false;
		await this.objectRepository.activateObjects(descendants);
		await this.objectRepository.markCheckpointDescendantsPlanned(
			object.remoteId
		);
		return true;
	}

	private requestCheckpointFanoutEvent(
		object: HistoryArchiveObject,
		promotePlannedObjects: boolean
	): Promise<void> {
		if (
			object.objectType !== 'checkpoint-state' ||
			object.status !== 'verified' ||
			object.descendantsPlannedAt !== null
		) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const pending = this.pendingCheckpointFanouts.get(object.remoteId);
			if (pending === undefined) {
				this.pendingCheckpointFanouts.set(object.remoteId, {
					object,
					promotePlannedObjects,
					waiters: [{ reject, resolve }]
				});
			} else {
				pending.promotePlannedObjects ||= promotePlannedObjects;
				pending.waiters.push({ reject, resolve });
			}
			this.scheduleCheckpointFanoutEvent();
		});
	}

	private scheduleCheckpointFanoutEvent(): void {
		if (this.checkpointFanoutEventRunning) return;
		this.checkpointFanoutEventRunning = true;
		setImmediate(() => {
			void this.drainCheckpointFanoutEvents();
		});
	}

	private async drainCheckpointFanoutEvents(): Promise<void> {
		try {
			while (this.pendingCheckpointFanouts.size > 0) {
				const batch = [...this.pendingCheckpointFanouts.values()];
				this.pendingCheckpointFanouts.clear();
				try {
					await this.processCheckpointFanoutBatch(batch);
					for (const pending of batch) {
						for (const waiter of pending.waiters) waiter.resolve();
					}
				} catch (error) {
					for (const pending of batch) {
						for (const waiter of pending.waiters) waiter.reject(error);
					}
				}
			}
		} finally {
			this.checkpointFanoutEventRunning = false;
			if (this.pendingCheckpointFanouts.size > 0) {
				this.scheduleCheckpointFanoutEvent();
			}
		}
	}

	private async processCheckpointFanoutBatch(
		batch: readonly PendingCheckpointFanout[]
	): Promise<void> {
		const remoteIds = batch.map((pending) => pending.object.remoteId);
		if (remoteIds.length === 1) {
			await this.objectRepository.materializeCheckpointDependencies(
				remoteIds[0]
			);
		} else {
			await this.objectRepository.materializeCheckpointDependencyBatch(
				remoteIds
			);
		}

		const built = await Promise.all(
			batch.map(async (pending) => ({
				descendants: await this.buildObjectsFromCheckpointArchiveMetadata(
					pending.object,
					pending.object.verificationFacts
				),
				pending
			}))
		);
		const planned = built.filter((entry) => entry.descendants.length > 0);
		if (planned.length === 0) return;

		const descendants = planned.flatMap((entry) => entry.descendants);
		const activateImmediately = planned.some(
			(entry) => entry.pending.promotePlannedObjects
		);
		if (activateImmediately) {
			await this.objectRepository.activateObjects(descendants);
		} else {
			await this.objectRepository.planObjects(descendants);
		}
		const plannedRemoteIds = planned.map(
			(entry) => entry.pending.object.remoteId
		);
		if (plannedRemoteIds.length === 1) {
			await this.objectRepository.markCheckpointDescendantsPlanned(
				plannedRemoteIds[0]
			);
		} else {
			await this.objectRepository.markCheckpointDescendantsPlannedBatch(
				plannedRemoteIds
			);
		}
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
		this.pendingProofCompletionRemoteIds.add(object.remoteId);
		if (this.proofCompletionEventRunning) return;
		this.proofCompletionEventRunning = true;
		setImmediate(() => {
			void this.drainProofCompletionEvents();
		});
	}

	private async drainProofCompletionEvents(): Promise<void> {
		try {
			while (this.pendingProofCompletionRemoteIds.size > 0) {
				const remoteIds = [...this.pendingProofCompletionRemoteIds];
				this.pendingProofCompletionRemoteIds.clear();
				try {
					if (remoteIds.length > 0) {
						const enqueued =
							await this.objectRepository.enqueueCheckpointProofRefreshes(
								remoteIds
							);
						if (enqueued > 0) {
							notifyHistoryArchiveProofRefreshReady();
						}
					}
				} catch {
					// Terminal object state is durable. The frontier reconciler
					// recovers any enqueue missed by a process interruption.
					continue;
				}
			}
		} finally {
			this.proofCompletionEventRunning = false;
			if (this.pendingProofCompletionRemoteIds.size > 0) {
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
