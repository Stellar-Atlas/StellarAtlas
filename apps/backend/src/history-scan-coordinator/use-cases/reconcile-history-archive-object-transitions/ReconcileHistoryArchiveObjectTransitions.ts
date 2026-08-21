import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';
import {
	historyArchiveMaintenanceIntervalsFromEnv,
	historyArchiveMaintenanceLanesFromEnv
} from './HistoryArchiveMaintenanceConfig.js';

// Re-select priority frequently so completed proof-frontier objects do not wait
// behind a long, stale transition batch.
const defaultReconciliationBatchSize = 24;
const maximumReconciliationBatchSize = 192;
const defaultTargetedProofRefreshBatchSize = 1;
const maximumTargetedProofRefreshBatchSize = 192;

export function parseHistoryArchiveTransitionReconciliationBatchSize(
	configuredBatchSize: string | undefined
): number {
	if (configuredBatchSize === undefined) return defaultReconciliationBatchSize;
	const parsedBatchSize = Number(configuredBatchSize);
	if (!Number.isSafeInteger(parsedBatchSize) || parsedBatchSize < 1) {
		return defaultReconciliationBatchSize;
	}
	return Math.min(parsedBatchSize, maximumReconciliationBatchSize);
}

export function parseTargetedProofRefreshBatchSize(
	configuredBatchSize: string | undefined
): number {
	if (configuredBatchSize === undefined) {
		return defaultTargetedProofRefreshBatchSize;
	}
	const parsed = Number(configuredBatchSize);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		return defaultTargetedProofRefreshBatchSize;
	}
	return Math.min(parsed, maximumTargetedProofRefreshBatchSize);
}

interface ReconciliationOptions {
	readonly promotePlannedObjects?: boolean;
}

@injectable()
export class ReconcileHistoryArchiveObjectTransitions {
	private readonly maintenanceIntervals =
		historyArchiveMaintenanceIntervalsFromEnv();
	private readonly maintenanceLanes = historyArchiveMaintenanceLanesFromEnv();
	private readonly reconciliationBatchSize =
		parseHistoryArchiveTransitionReconciliationBatchSize(
			process.env.HISTORY_ARCHIVE_TRANSITION_RECONCILIATION_BATCH_SIZE
		);
	private readonly targetedProofRefreshBatchSize =
		parseTargetedProofRefreshBatchSize(
			process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE
		);
	private readonly legacyFrontierEnabled =
		process.env.HISTORY_ARCHIVE_LEGACY_FRONTIER_ENABLED === 'true';
	private executionDispositionRunning = false;
	private nextExecutionDispositionRunAt = 0;
	private nextTargetedProofRefreshRunAt = 0;
	private nextTransitionRunAt = 0;

	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly completeObject: CompleteHistoryArchiveObject,
		private readonly failObject: FailHistoryArchiveObject,
		@inject('Logger') private readonly logger: Logger
	) {}

	async executeIfDue(
		now = Date.now(),
		options: ReconciliationOptions = {}
	): Promise<void> {
		await this.executeTargetedProofRefreshIfDue(now);
		await this.executeTransitionReconciliationIfDue(now, options);
		await this.executeExecutionDispositionReconciliationIfDue(now);
	}

	async executeTargetedProofRefreshIfDue(now = Date.now()): Promise<void> {
		if (!this.maintenanceLanes.targetedProofRefreshEnabled) return;
		if (now < this.nextTargetedProofRefreshRunAt) return;
		this.nextTargetedProofRefreshRunAt =
			now + this.maintenanceIntervals.transitionReconciliationIntervalMs;

		const result = await this.objectRepository.drainCheckpointProofRefreshQueue(
			this.targetedProofRefreshBatchSize,
			this.maintenanceLanes.targetedProofRefreshMaximumPriority
		);
		if (result.failed > 0) {
			this.logger.error('Failed targeted checkpoint proof refresh', {
				app: 'history-scan-coordinator',
				claimed: result.claimed,
				completed: result.completed,
				failed: result.failed
			});
		}
	}

	async executeTransitionReconciliationIfDue(
		now = Date.now(),
		options: ReconciliationOptions = {}
	): Promise<void> {
		const promotePlannedObjects =
			this.maintenanceLanes.promotePlannedObjectsEnabled &&
			options.promotePlannedObjects !== false;
		if (
			!promotePlannedObjects &&
			!this.maintenanceLanes.terminalTransitionReconciliationEnabled &&
			!this.maintenanceLanes.checkpointDependencyReconciliationEnabled
		) {
			return;
		}
		if (now < this.nextTransitionRunAt) return;
		this.nextTransitionRunAt =
			now + this.maintenanceIntervals.transitionReconciliationIntervalMs;

		await this.objectRepository.tryWithTransitionReconciliationLock(
			async () => {
				if (promotePlannedObjects) {
					await this.objectRepository.promotePlannedObjects();
				}
				const fanoutCheckpoints =
					(await this.objectRepository.findVerifiedCheckpointsNeedingFanout(
						this.reconciliationBatchSize
					)) ?? [];
				for (const checkpoint of fanoutCheckpoints) {
					try {
						await this.completeObject.reconcileCheckpointFanout(checkpoint);
					} catch (error) {
						this.logFailure(error, checkpoint, 'checkpoint fanout');
					}
				}
				if (this.maintenanceLanes.terminalTransitionReconciliationEnabled) {
					const objects =
						await this.objectRepository.findUnreconciledTransitions(
							this.reconciliationBatchSize
						);
					for (const object of objects) {
						try {
							if (object.status === 'verified') {
								await this.reconcileVerifiedClaimAttempt(
									object.remoteId,
									object.attempts,
									promotePlannedObjects
								);
							} else if (object.status === 'failed') {
								await this.failObject.reconcileClaimAttempt(
									object.remoteId,
									object.attempts
								);
							}
						} catch (error) {
							this.logFailure(error, object, 'transition');
						}
					}
				}
				if (this.maintenanceLanes.checkpointDependencyReconciliationEnabled) {
					const checkpoints =
						await this.objectRepository.findVerifiedCheckpointsNeedingReconciliation(
							this.reconciliationBatchSize
						);
					for (const checkpoint of checkpoints) {
						try {
							await this.completeObject.reconcileCheckpointDependencies(
								checkpoint
							);
						} catch (error) {
							this.logFailure(error, checkpoint, 'checkpoint dependencies');
						}
					}
				}
			}
		);
	}

	async executeExecutionDispositionReconciliationIfDue(
		now = Date.now()
	): Promise<void> {
		if (!this.maintenanceLanes.executionAdmissionEnabled) return;
		if (
			this.executionDispositionRunning ||
			now < this.nextExecutionDispositionRunAt
		) {
			return;
		}
		this.executionDispositionRunning = true;
		this.nextExecutionDispositionRunAt =
			now + this.maintenanceIntervals.executionAdmissionIntervalMs;
		try {
			await this.objectRepository.reconcileExecutionDisposition({
				admitGenericObjects: this.legacyFrontierEnabled
			});
		} catch (error) {
			this.logger.error('Failed to reconcile archive execution frontier', {
				app: 'history-scan-coordinator',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		} finally {
			this.executionDispositionRunning = false;
		}
	}

	private async reconcileVerifiedClaimAttempt(
		remoteId: string,
		claimAttempt: number,
		promotePlannedObjects: boolean
	): Promise<void> {
		if (promotePlannedObjects) {
			await this.completeObject.reconcileClaimAttempt(remoteId, claimAttempt);
			return;
		}
		await this.completeObject.reconcileClaimAttempt(remoteId, claimAttempt, {
			promotePlannedObjects: false
		});
	}

	private logFailure(
		error: unknown,
		object: { readonly remoteId: string; readonly status: string },
		work: 'checkpoint dependencies' | 'checkpoint fanout' | 'transition'
	): void {
		this.logger.error(`Failed to reconcile archive object ${work}`, {
			app: 'history-scan-coordinator',
			errorMessage: error instanceof Error ? error.message : String(error),
			remoteId: object.remoteId,
			status: object.status
		});
	}
}
