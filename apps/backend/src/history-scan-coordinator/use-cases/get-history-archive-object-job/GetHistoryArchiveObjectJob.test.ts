import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import type { ReconcileHistoryArchiveObjectTransitions } from '../reconcile-history-archive-object-transitions/ReconcileHistoryArchiveObjectTransitions.js';
import { GetHistoryArchiveObjectJob } from './GetHistoryArchiveObjectJob.js';

describe('GetHistoryArchiveObjectJob', () => {
	it('refreshes proofs for stale releases and claimed retries', async () => {
		const stale = checkpointObject(127, 'pending');
		stale.attempts = 1;
		const claimed = checkpointObject(191, 'scanning');
		claimed.attempts = 2;
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		objectRepository.releaseStaleObjects.mockResolvedValue([stale]);
		objectRepository.claimNextObject.mockResolvedValue(claimed);
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		const transitionReconciler =
			mock<ReconcileHistoryArchiveObjectTransitions>();
		const useCase = new GetHistoryArchiveObjectJob(
			objectRepository,
			proofRepository,
			eventRecorder,
			transitionReconciler,
			mock<Logger>()
		);

		expect((await useCase.execute())._unsafeUnwrap()).toMatchObject({
			claimAttempt: 2,
			remoteId: claimed.remoteId
		});
		expect(proofRepository.refreshForObject).toHaveBeenNthCalledWith(1, stale);
		expect(proofRepository.refreshForObject).toHaveBeenNthCalledWith(
			2,
			claimed
		);
		expect(eventRecorder.recordDurably).toHaveBeenCalledWith(stale, {
			claimAttempt: 1,
			eventType: 'released'
		});
		expect(eventRecorder.record).toHaveBeenCalledWith(claimed, {
			claimAttempt: 2,
			eventType: 'claimed'
		});
		expect(transitionReconciler.executeIfDue).toHaveBeenCalledTimes(1);
	});
});

function checkpointObject(
	checkpointLedger: number,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl: 'https://jobs.example/archive',
		archiveUrlIdentity: 'https://jobs.example/archive',
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointLedger}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `https://jobs.example/archive/${checkpointLedger}.json`,
		status
	});
}
