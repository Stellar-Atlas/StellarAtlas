import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { historyArchiveConsumerCount } from '../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import type { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';
import {
	parseHistoryArchiveTransitionReconciliationBatchSize,
	ReconcileHistoryArchiveObjectTransitions
} from './ReconcileHistoryArchiveObjectTransitions.js';

const expectedReconciliationBatchSize = Math.min(
	5_000,
	historyArchiveConsumerCount * 8
);

describe('archive transition reconciliation batch configuration', () => {
	it('derives the default and cap from worker capacity', () => {
		expect(
			parseHistoryArchiveTransitionReconciliationBatchSize(undefined)
		).toBe(expectedReconciliationBatchSize);
		expect(parseHistoryArchiveTransitionReconciliationBatchSize('48')).toBe(48);
		expect(parseHistoryArchiveTransitionReconciliationBatchSize('192')).toBe(
			192
		);
		expect(parseHistoryArchiveTransitionReconciliationBatchSize('5000')).toBe(
			5_000
		);
		expect(
			parseHistoryArchiveTransitionReconciliationBatchSize('invalid')
		).toBe(expectedReconciliationBatchSize);
	});
});

describe('ReconcileHistoryArchiveObjectTransitions', () => {
	it('reconciles verified and failed transitions under the distributed lock', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const fail = mock<FailHistoryArchiveObject>();
		let transitionLockHeld = false;
		const verified = terminalObject('verified', 'verified.example');
		const failed = terminalObject('failed', 'failed.example');
		repository.findUnreconciledTransitions.mockResolvedValue([
			verified,
			failed
		]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				transitionLockHeld = true;
				await work();
				transitionLockHeld = false;
				return true;
			}
		);
		repository.reconcileExecutionDisposition.mockImplementation(async () => {
			expect(transitionLockHeld).toBe(false);
			return {
				admittedObjects: 0,
				availableSlots: 0,
				cursorAdvances: 0,
				outstandingObjects: 0,
				preservedObjects: 0,
				recentCompletions: 0,
				watermark: 0
			};
		});
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			fail,
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000);
		expect(repository.reconcileExecutionDisposition).toHaveBeenCalledTimes(1);
		expect(
			complete.reconcileVerifiedTransitionBatch.mock.invocationCallOrder[0]
		).toBeLessThan(
			repository.reconcileExecutionDisposition.mock.invocationCallOrder[0] ??
				Infinity
		);

		expect(complete.reconcileVerifiedTransitionBatch).toHaveBeenCalledWith(
			[verified],
			{}
		);
		expect(fail.reconcileFailedTransitionBatch).toHaveBeenCalledWith([failed]);
		expect(repository.findUnreconciledTransitions).toHaveBeenCalledWith(
			expectedReconciliationBatchSize
		);
		expect(
			repository.findVerifiedCheckpointsNeedingReconciliation
		).toHaveBeenCalledWith(expectedReconciliationBatchSize);
	});

	it('continues the batch when one transition effect fails', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const fail = mock<FailHistoryArchiveObject>();
		const logger = mock<Logger>();
		const failed = terminalObject('failed', 'failed.example');
		repository.findUnreconciledTransitions.mockResolvedValue([
			terminalObject('verified', 'verified.example'),
			failed
		]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);
		complete.reconcileVerifiedTransitionBatch.mockRejectedValue(
			new Error('proof unavailable')
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			fail,
			logger
		);

		await reconciler.executeIfDue(10_000);

		expect(fail.reconcileFailedTransitionBatch).toHaveBeenCalledWith([failed]);
		expect(logger.error).toHaveBeenCalledWith(
			'Failed to reconcile archive object transition',
			expect.objectContaining({ errorMessage: 'proof unavailable' })
		);
	});

	it('materializes legacy checkpoint dependencies under the reconciliation lock', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const checkpoint = terminalCheckpoint();
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue([
			checkpoint
		]);
		repository.findUnreconciledTransitions.mockResolvedValue([]);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			mock<FailHistoryArchiveObject>(),
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000);

		expect(complete.reconcileCheckpointDependencyBatch).toHaveBeenCalledWith([
			checkpoint
		]);
	});

	it('reconciles terminal transitions before legacy dirty checkpoints', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const verified = terminalObject('verified', 'verified.example');
		const checkpoint = terminalCheckpoint();
		repository.findUnreconciledTransitions.mockResolvedValue([verified]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue([
			checkpoint
		]);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			mock<FailHistoryArchiveObject>(),
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000);

		expect(
			complete.reconcileVerifiedTransitionBatch.mock.invocationCallOrder[0]
		).toBeLessThan(
			complete.reconcileCheckpointDependencies.mock.invocationCallOrder[0] ??
				Infinity
		);
	});

	it('keeps terminal proof effects when later execution admission fails', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const logger = mock<Logger>();
		const verified = terminalObject('verified', 'verified.example');
		repository.reconcileExecutionDisposition.mockRejectedValue(
			new Error('admission unavailable')
		);
		repository.findUnreconciledTransitions.mockResolvedValue([verified]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			mock<FailHistoryArchiveObject>(),
			logger
		);

		await reconciler.executeIfDue(10_000);

		expect(complete.reconcileVerifiedTransitionBatch).toHaveBeenCalledWith(
			[verified],
			{}
		);
		expect(logger.error).toHaveBeenCalledWith(
			'Failed to reconcile archive execution frontier',
			expect.objectContaining({ errorMessage: 'admission unavailable' })
		);
	});

	it('throttles repeated claim-path reconciliation in one API process', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockResolvedValue(false);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			mock<CompleteHistoryArchiveObject>(),
			mock<FailHistoryArchiveObject>(),
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000);
		await reconciler.executeIfDue(10_001);
		await reconciler.executeIfDue(11_000);

		expect(
			repository.tryWithTransitionReconciliationLock
		).toHaveBeenCalledTimes(2);
	});

	it('can reconcile transitions without duplicating a caller-owned promotion', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		repository.findUnreconciledTransitions.mockResolvedValue([]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			mock<CompleteHistoryArchiveObject>(),
			mock<FailHistoryArchiveObject>(),
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000, {
			promotePlannedObjects: false
		});

		expect(repository.promotePlannedObjects).not.toHaveBeenCalled();
		expect(repository.findUnreconciledTransitions).toHaveBeenCalledWith(
			expectedReconciliationBatchSize
		);
	});

	it('disables legacy generic admission unless explicitly enabled', async () => {
		const previousMode = process.env.HISTORY_ARCHIVE_SCHEDULER_MODE;
		process.env.HISTORY_ARCHIVE_SCHEDULER_MODE = 'broker';
		try {
			const repository = mock<HistoryArchiveObjectRepository>();
			repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
				claimed: 0,
				completed: 0,
				failed: 0
			});
			repository.tryWithTransitionReconciliationLock.mockResolvedValue(false);
			const reconciler = new ReconcileHistoryArchiveObjectTransitions(
				repository,
				mock<CompleteHistoryArchiveObject>(),
				mock<FailHistoryArchiveObject>(),
				mock<Logger>()
			);

			await reconciler.executeIfDue(10_000);

			expect(repository.reconcileExecutionDisposition).toHaveBeenCalledWith({
				admitGenericObjects: false
			});
		} finally {
			if (previousMode === undefined) {
				delete process.env.HISTORY_ARCHIVE_SCHEDULER_MODE;
			} else {
				process.env.HISTORY_ARCHIVE_SCHEDULER_MODE = previousMode;
			}
		}
	});

	it('fans out bounded verified checkpoints under the transition lock', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const complete = mock<CompleteHistoryArchiveObject>();
		const checkpoint = terminalCheckpoint();
		repository.findVerifiedCheckpointsNeedingFanout.mockResolvedValue([
			checkpoint
		]);
		repository.findUnreconciledTransitions.mockResolvedValue([]);
		repository.findVerifiedCheckpointsNeedingReconciliation.mockResolvedValue(
			[]
		);
		repository.tryWithTransitionReconciliationLock.mockImplementation(
			async (work) => {
				await work();
				return true;
			}
		);

		await new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			mock<FailHistoryArchiveObject>(),
			mock<Logger>()
		).executeIfDue(10_000);

		expect(complete.reconcileCheckpointFanout).toHaveBeenCalledWith(checkpoint);
	});
});

function terminalObject(
	status: 'failed' | 'verified',
	host: string
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl: `https://${host}/archive`,
		archiveUrlIdentity: `https://${host}/archive`,
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl: `https://${host}/archive/.well-known/stellar-history.json`,
		status
	});
	object.transitionEffectsRequiredAt = new Date();
	return object;
}

function terminalCheckpoint(): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl: 'https://checkpoint.example/archive',
		archiveUrlIdentity: 'https://checkpoint.example/archive',
		checkpointLedger: 63,
		objectKey: 'checkpoint-state:0000003f',
		objectOrder: 1,
		objectType: 'checkpoint-state',
		objectUrl:
			'https://checkpoint.example/archive/history/00/00/00/history-0000003f.json',
		status: 'verified'
	});
}
