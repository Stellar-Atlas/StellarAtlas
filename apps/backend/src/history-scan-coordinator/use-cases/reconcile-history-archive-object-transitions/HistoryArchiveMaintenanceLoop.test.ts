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
		reconciler.executeTargetedProofRefreshIfDue.mockResolvedValue(undefined);
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
			reconciler.executeTargetedProofRefreshIfDue.mockClear();

			process.emit('message', {
				type: historyArchiveProofRefreshWakeType
			});
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				1
			);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledWith(
				expect.any(Number),
				true
			);
		} finally {
			stop();
		}
	});
});
