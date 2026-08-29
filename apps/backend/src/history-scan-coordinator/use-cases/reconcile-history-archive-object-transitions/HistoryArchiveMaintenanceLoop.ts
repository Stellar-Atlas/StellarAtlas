import process from 'node:process';
import type { Logger } from 'logger';
import { isHistoryArchiveProofRefreshWakeMessage } from '../../infrastructure/ipc/HistoryArchiveProofRefreshWake.js';
import type { ReconcileHistoryArchiveObjectTransitions } from './ReconcileHistoryArchiveObjectTransitions.js';
import {
	historyArchiveMaintenanceIntervalsFromEnv,
	parseHistoryArchiveMaintenanceIntervalMs,
	type HistoryArchiveMaintenanceIntervals
} from './HistoryArchiveMaintenanceConfig.js';

// Keep the production API writer's existing import and numeric third argument
// compatible while its call site is upgraded independently.
export { parseHistoryArchiveMaintenanceIntervalMs } from './HistoryArchiveMaintenanceConfig.js';

export function startHistoryArchiveMaintenanceLoop(
	reconciler: ReconcileHistoryArchiveObjectTransitions,
	logger: Logger,
	configuredIntervals:
		| HistoryArchiveMaintenanceIntervals
		| number = historyArchiveMaintenanceIntervalsFromEnv()
): () => void {
	let stopped = false;
	const intervals = resolveMaintenanceIntervals(configuredIntervals);

	const createRunner = (
		maintenanceWork: 'execution disposition' | 'proof refresh' | 'transitions',
		work: () => Promise<void>
	): (() => Promise<void>) => {
		let rerunRequested = false;
		let running = false;
		return async (): Promise<void> => {
			if (running) {
				rerunRequested = true;
				return;
			}
			running = true;
			try {
				do {
					rerunRequested = false;
					await work();
				} while (rerunRequested && !stopped);
			} catch (error: unknown) {
				logger.error('Failed to maintain archive object queue', {
					app: 'history-scan-coordinator',
					errorMessage: error instanceof Error ? error.message : String(error),
					maintenanceWork
				});
			} finally {
				running = false;
			}
		};
	};
	let forceProofRefresh = false;
	const runTransitions = createRunner('transitions', () =>
		reconciler.executeTransitionReconciliationIfDue()
	);
	const runProofRefresh = createRunner('proof refresh', async () => {
		const force = forceProofRefresh;
		forceProofRefresh = false;
		await reconciler.executeTargetedProofRefreshIfDue(Date.now(), force);
	});
	const runExecutionDisposition = createRunner('execution disposition', () =>
		reconciler.executeExecutionDispositionReconciliationIfDue()
	);
	const onProofRefreshWake = (message: unknown): void => {
		if (!isHistoryArchiveProofRefreshWakeMessage(message)) return;
		forceProofRefresh = true;
		void runProofRefresh();
	};
	process.on('message', onProofRefreshWake);

	const proofRefreshTimer = setInterval(() => {
		void runProofRefresh();
	}, intervals.transitionReconciliationIntervalMs);
	proofRefreshTimer.unref();
	const transitionTimer = setInterval(() => {
		void runTransitions();
	}, intervals.transitionReconciliationIntervalMs);
	transitionTimer.unref();
	const executionAdmissionTimer = setInterval(() => {
		void runExecutionDisposition();
	}, intervals.executionAdmissionIntervalMs);
	executionAdmissionTimer.unref();
	void runProofRefresh();
	void runTransitions();
	void runExecutionDisposition();

	return () => {
		stopped = true;
		clearInterval(proofRefreshTimer);
		clearInterval(transitionTimer);
		clearInterval(executionAdmissionTimer);
		process.off('message', onProofRefreshWake);
	};
}
function resolveMaintenanceIntervals(
	configuredIntervals: HistoryArchiveMaintenanceIntervals | number
): HistoryArchiveMaintenanceIntervals {
	if (typeof configuredIntervals !== 'number') return configuredIntervals;

	return Object.freeze({
		...historyArchiveMaintenanceIntervalsFromEnv(),
		transitionReconciliationIntervalMs:
			parseHistoryArchiveMaintenanceIntervalMs(String(configuredIntervals))
	});
}
