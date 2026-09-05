import process from 'node:process';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import {
	historyArchiveProofRefreshWakeType,
	isHistoryArchiveProofRefreshWakeMessage,
	notifyHistoryArchiveProofRefreshReady
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

	it('forces only proof refresh when archive work completes', async () => {
		const configuredWriter = process.env.API_HISTORY_MAINTENANCE_WRITER;
		process.env.API_HISTORY_MAINTENANCE_WRITER = 'true';
		const reconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		reconciler.executeTargetedProofRefreshIfDue.mockResolvedValue(0);
		reconciler.executeTransitionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		reconciler.executeExecutionDispositionReconciliationIfDue.mockResolvedValue(
			0
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

			notifyHistoryArchiveProofRefreshReady();
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(
				reconciler.executeTransitionReconciliationIfDue
			).not.toHaveBeenCalled();
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				1
			);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledWith(
				expect.any(Number),
				true
			);
			expect(
				reconciler.executeExecutionDispositionReconciliationIfDue
			).not.toHaveBeenCalled();
		} finally {
			stop();
			if (configuredWriter === undefined) {
				delete process.env.API_HISTORY_MAINTENANCE_WRITER;
			} else {
				process.env.API_HISTORY_MAINTENANCE_WRITER = configuredWriter;
			}
		}
	});

	it('drains proof batches without restarting recovery scans for every batch', async () => {
		const reconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		reconciler.executeTransitionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		reconciler.executeTargetedProofRefreshIfDue
			.mockResolvedValueOnce(24)
			.mockResolvedValue(0);
		reconciler.executeExecutionDispositionReconciliationIfDue.mockResolvedValue(
			0
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

			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				2
			);
			expect(
				reconciler.executeTransitionReconciliationIfDue
			).toHaveBeenCalledTimes(1);
			expect(
				reconciler.executeExecutionDispositionReconciliationIfDue
			).toHaveBeenCalledTimes(1);
		} finally {
			stop();
		}
	});

	it('continues immediately when compact planning advances a cursor', async () => {
		const reconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		reconciler.executeTransitionReconciliationIfDue.mockResolvedValue(
			undefined
		);
		reconciler.executeTargetedProofRefreshIfDue.mockResolvedValue(0);
		reconciler.executeExecutionDispositionReconciliationIfDue
			.mockResolvedValueOnce(1)
			.mockResolvedValue(0);
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
				reconciler.executeExecutionDispositionReconciliationIfDue
			).toHaveBeenCalledTimes(2);
			expect(
				reconciler.executeExecutionDispositionReconciliationIfDue
			).toHaveBeenNthCalledWith(2, expect.any(Number), true);
			expect(reconciler.executeTargetedProofRefreshIfDue).toHaveBeenCalledTimes(
				2
			);
		} finally {
			stop();
		}
	});
});
