import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { CompleteHistoryArchiveObject } from '../complete-history-archive-object/CompleteHistoryArchiveObject.js';
import type { FailHistoryArchiveObject } from '../fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReconcileHistoryArchiveObjectTransitions } from './ReconcileHistoryArchiveObjectTransitions.js';

describe('targeted checkpoint proof refresh concurrency', () => {
	it('drains proof work when the long transition lock is held elsewhere', async () => {
		const enabled = process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED;
		const priority =
			process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_MAX_PRIORITY;
		const batch = process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE;
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED = 'true';
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_MAX_PRIORITY = '1';
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE = '4';

		try {
			const repository = mock<HistoryArchiveObjectRepository>();
			const recoverCheckpointProofRefreshes = jest.fn().mockResolvedValue(4);
			repository.recoverCheckpointProofRefreshes =
				recoverCheckpointProofRefreshes;
			repository.drainCheckpointProofRefreshQueue
				.mockResolvedValueOnce({
					claimed: 4,
					completed: 4,
					failed: 0
				})
				.mockResolvedValue({
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

			const completed =
				await reconciler.executeTargetedProofRefreshIfDue(10_000);

			expect(recoverCheckpointProofRefreshes).toHaveBeenCalledWith(4);

			expect(repository.drainCheckpointProofRefreshQueue).toHaveBeenCalledWith(
				4,
				1
			);
			expect(repository.drainCheckpointProofRefreshQueue).toHaveBeenCalledTimes(
				1
			);
			expect(completed).toBe(4);
		} finally {
			restoreEnv('HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED', enabled);
			restoreEnv(
				'HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_MAX_PRIORITY',
				priority
			);
			restoreEnv('HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE', batch);
		}
	});
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
