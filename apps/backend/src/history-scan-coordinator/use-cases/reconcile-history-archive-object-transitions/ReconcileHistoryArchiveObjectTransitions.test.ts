import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import type { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReconcileHistoryArchiveObjectTransitions } from './ReconcileHistoryArchiveObjectTransitions.js';

describe('ReconcileHistoryArchiveObjectTransitions', () => {
	it('reconciles verified and failed transitions under the distributed lock', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		const complete = mock<CompleteHistoryArchiveObject>();
		const fail = mock<FailHistoryArchiveObject>();
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
				await work();
				return true;
			}
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			fail,
			mock<Logger>()
		);

		await reconciler.executeIfDue(10_000);
		expect(repository.reconcileExecutionDisposition).toHaveBeenCalledTimes(1);

		expect(complete.reconcilePersisted).toHaveBeenCalledWith(verified);
		expect(fail.reconcilePersisted).toHaveBeenCalledWith(failed);
	});

	it('continues the batch when one transition effect fails', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
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
		complete.reconcilePersisted.mockRejectedValue(
			new Error('proof unavailable')
		);
		const reconciler = new ReconcileHistoryArchiveObjectTransitions(
			repository,
			complete,
			fail,
			logger
		);

		await reconciler.executeIfDue(10_000);

		expect(fail.reconcilePersisted).toHaveBeenCalledWith(failed);
		expect(logger.error).toHaveBeenCalledWith(
			'Failed to reconcile archive object transition',
			expect.objectContaining({ errorMessage: 'proof unavailable' })
		);
	});

	it('materializes legacy checkpoint dependencies before transition effects', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
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

		expect(complete.reconcileCheckpointDependencies).toHaveBeenCalledWith(
			checkpoint
		);
	});

	it('throttles repeated claim-path reconciliation in one API process', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
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
		await reconciler.executeIfDue(15_000);

		expect(
			repository.tryWithTransitionReconciliationLock
		).toHaveBeenCalledTimes(2);
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
