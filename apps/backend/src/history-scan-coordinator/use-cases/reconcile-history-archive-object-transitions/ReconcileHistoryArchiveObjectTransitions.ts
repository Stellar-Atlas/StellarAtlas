import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import { historyArchiveConsumerCount } from '../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';
import {
	historyArchiveMaintenanceIntervalsFromEnv,
	historyArchiveMaintenanceLanesFromEnv,
	parseTargetedProofRefreshBatchSize
} from './HistoryArchiveMaintenanceConfig.js';

export { parseTargetedProofRefreshBatchSize };

// Re-select priority frequently so completed proof-frontier objects do not wait
// behind a long, stale transition batch.
const defaultReconciliationBatchSize = historyArchiveConsumerCount;
const maximumReconciliationBatchSize = historyArchiveConsumerCount;

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

	async executeTargetedProofRefreshIfDue(
		now = Date.now(),
		force = false
	): Promise<number> {
		if (!this.maintenanceLanes.targetedProofRefreshEnabled) return 0;
		if (!force && now < this.nextTargetedProofRefreshRunAt) return 0;
		this.nextTargetedProofRefreshRunAt =
			now + this.maintenanceIntervals.transitionReconciliationIntervalMs;

		await this.objectRepository.recoverCheckpointProofRefreshes?.(
			this.targetedProofRefreshBatchSize
		);
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
		return result.completed;
	}

	async executeTransitionReconciliationIfDue(
		now = Date.now(),
		options: ReconciliationOptions = {},
		force = false
	): Promise<void> {
		const promotePlannedObjects =
			this.maintenanceLanes.promotePlannedObjectsEnabled &&
			options.promotePlannedObjects !== false;
		if (!force && now < this.nextTransitionRunAt) return;
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
				if (fanoutCheckpoints.length > 0) {
					try {
						if (fanoutCheckpoints.length === 1) {
							await this.completeObject.reconcileCheckpointFanout(
								fanoutCheckpoints[0]
							);
						} else {
							await this.completeObject.reconcileCheckpointFanouts(
								fanoutCheckpoints
							);
						}
					} catch (error) {
						for (const checkpoint of fanoutCheckpoints) {
							this.logFailure(error, checkpoint, 'checkpoint fanout');
						}
					}
				}
				if (this.maintenanceLanes.terminalTransitionReconciliationEnabled) {
					const objects =
						await this.objectRepository.findUnreconciledTransitions(
							this.reconciliationBatchSize
						);
					const verifiedObjects = objects.filter(
						(object) => object.status === 'verified'
					);
					if (verifiedObjects.length > 0) {
						try {
							await this.completeObject.reconcileVerifiedTransitionBatch(
								verifiedObjects,
								promotePlannedObjects ? {} : { promotePlannedObjects: false }
							);
						} catch (error) {
							for (const object of verifiedObjects) {
								this.logFailure(error, object, 'transition');
							}
						}
					}
					for (const object of objects) {
						if (object.status !== 'failed') continue;
						try {
							await this.failObject.reconcileClaimAttempt(
								object.remoteId,
								object.attempts
							);
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
					if (checkpoints.length > 0) {
						try {
							await this.completeObject.reconcileCheckpointDependencyBatch(
								checkpoints
							);
						} catch (error) {
							for (const checkpoint of checkpoints) {
								this.logFailure(error, checkpoint, 'checkpoint dependencies');
							}
						}
					}
				}
			}
		);
	}

	async executeExecutionDispositionReconciliationIfDue(
		now = Date.now(),
		force = false
	): Promise<number> {
		if (!this.maintenanceLanes.executionAdmissionEnabled) return 0;
		if (
			this.executionDispositionRunning ||
			(!force && now < this.nextExecutionDispositionRunAt)
		) {
			return 0;
		}
		this.executionDispositionRunning = true;
		this.nextExecutionDispositionRunAt =
			now + this.maintenanceIntervals.executionAdmissionIntervalMs;
		try {
			const result = await this.objectRepository.reconcileExecutionDisposition({
				admitGenericObjects: this.legacyFrontierEnabled
			});
			return result.cursorAdvances;
		} catch (error) {
			this.logger.error('Failed to reconcile archive execution frontier', {
				app: 'history-scan-coordinator',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
			return 0;
		} finally {
			this.executionDispositionRunning = false;
		}
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
