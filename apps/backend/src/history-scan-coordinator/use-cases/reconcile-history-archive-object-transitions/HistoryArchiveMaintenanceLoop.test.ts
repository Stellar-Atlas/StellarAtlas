import process from 'node:process';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import {
	historyArchiveProofRefreshWakeType,
	isHistoryArchiveProofRefreshWakeMessage
} from '../../infrastructure/ipc/HistoryArchiveProofRefreshWake.js';
import type { ReconcileHistoryArchiveObjectTransitions } from './ReconcileHistoryArchiveObjectTransitions.js';
import { startHistoryArchiveMaintenanceLoop } from './HistoryArchiveMaintenanceLoop.js';

describe('history archive maintenance proof wake', () => {
	it('recognizes only the typed proof refresh wake message', () => {
		expect(
			isHistoryArchiveProofRefreshWakeMessage({
				type: historyArchiveProofRefreshWakeType
			})
		).toBe(true);
		expect(isHistoryArchiveProofRefreshWakeMessage({ type: 'other' })).toBe(
			false
		);
		expect(isHistoryArchiveProofRefreshWakeMessage(null)).toBe(false);
	});

	it('forces the designated writer immediately when another API worker enqueues proof work', async () => {
		const reconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		reconciler.executeTargetedProofRefreshIfDue.mockResolvedValue(0);
		reconciler.executeTransitionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		reconciler.executeExecutionDispositionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		const stop = startHistoryArchiveMaintenanceLoop(
			reconciler,
			mock<Logger>(),
			{
				executionAdmissionIntervalMs: 60_000,
				transitionReconciliationIntervalMs: 60_000
			}
		);
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			reconciler.executeTransitionReconciliationIfDue.mockClear();
			reconciler.executeTargetedProofRefreshIfDue.mockClear();
			reconciler.executeExecutionDispositionReconciliationIfDue.mockClear();

			process.emit('message', {
				type: historyArchiveProofRefreshWakeType
			});
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(
				reconciler.executeTransitionReconciliationIfDue
			).toHaveBeenCalledWith(expect.any(Number), {}, true);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				1
			);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledWith(
				expect.any(Number),
				true
			);
			expect(
				reconciler.executeExecutionDispositionReconciliationIfDue
			).toHaveBeenCalledWith(expect.any(Number), true);
			expect(
				reconciler.executeTransitionReconciliationIfDue.mock
					.invocationCallOrder[0]
			).toBeLessThan(
				reconciler.executeTargetedProofRefreshIfDue.mock.invocationCallOrder[0]!
			);
			expect(
				reconciler.executeTargetedProofRefreshIfDue.mock.invocationCallOrder[0]
			).toBeLessThan(
				reconciler.executeExecutionDispositionReconciliationIfDue.mock
					.invocationCallOrder[0]!
			);
		} finally {
			stop();
		}
	});

	it('fans out the next cohort immediately after proofs advance the cursor', async () => {
		const reconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		reconciler.executeTransitionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		reconciler.executeTargetedProofRefreshIfDue
			.mockResolvedValueOnce(24)
			.mockResolvedValue(0);
		reconciler.executeExecutionDispositionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		const stop = startHistoryArchiveMaintenanceLoop(
			reconciler,
			mock<Logger>(),
			{
				executionAdmissionIntervalMs: 60_000,
				transitionReconciliationIntervalMs: 60_000
			}
		);
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(
				reconciler.executeTransitionReconciliationIfDue
			).toHaveBeenCalledTimes(2);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				2
			);
			expect(
				reconciler.executeExecutionDispositionReconciliationIfDue
			).toHaveBeenCalledTimes(2);
		} finally {
			stop();
		}
	});
});
