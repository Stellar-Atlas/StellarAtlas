import type { Logger } from 'logger';
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
		let running = false;
		return async (): Promise<void> => {
			if (running || stopped) return;
			running = true;
			try {
				await work();
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
	const runTransitions = createRunner('transitions', () =>
		reconciler.executeTransitionReconciliationIfDue()
	);
	const runProofRefresh = createRunner('proof refresh', () =>
		reconciler.executeTargetedProofRefreshIfDue()
	);
	const runExecutionDisposition = createRunner('execution disposition', () =>
		reconciler.executeExecutionDispositionReconciliationIfDue()
	);

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
