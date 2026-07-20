import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';

// Re-select priority frequently so completed proof-frontier objects do not wait
// behind a long, stale transition batch.
const reconciliationBatchSize = 4;
const reconciliationIntervalMs = 5_000;

@injectable()
export class ReconcileHistoryArchiveObjectTransitions {
	private nextRunAt = 0;

	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly completeObject: CompleteHistoryArchiveObject,
		private readonly failObject: FailHistoryArchiveObject,
		@inject('Logger') private readonly logger: Logger
	) {}

	async executeIfDue(now = Date.now()): Promise<void> {
		if (now < this.nextRunAt) return;
		this.nextRunAt = now + reconciliationIntervalMs;

		await this.objectRepository.tryWithTransitionReconciliationLock(
			async () => {
				const objects = await this.objectRepository.findUnreconciledTransitions(
					reconciliationBatchSize
				);
				for (const object of objects) {
					try {
						if (object.status === 'verified') {
							await this.completeObject.reconcilePersisted(object);
						} else if (object.status === 'failed') {
							await this.failObject.reconcilePersisted(object);
						}
					} catch (error) {
						this.logFailure(error, object, 'transition');
					}
				}
				const checkpoints =
					await this.objectRepository.findVerifiedCheckpointsNeedingReconciliation(
						reconciliationBatchSize
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
		);
		await this.reconcileExecutionDisposition();
	}

	private async reconcileExecutionDisposition(): Promise<void> {
		try {
			await this.objectRepository.reconcileExecutionDisposition();
		} catch (error) {
			this.logger.error('Failed to reconcile archive execution frontier', {
				app: 'history-scan-coordinator',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private logFailure(
		error: unknown,
		object: { readonly remoteId: string; readonly status: string },
		work: 'checkpoint dependencies' | 'transition'
	): void {
		this.logger.error(`Failed to reconcile archive object ${work}`, {
			app: 'history-scan-coordinator',
			errorMessage: error instanceof Error ? error.message : String(error),
			remoteId: object.remoteId,
			status: object.status
		});
	}
}
