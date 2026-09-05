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

	const logFailure = (
		maintenanceWork: 'execution disposition' | 'proof refresh' | 'transitions',
		error: unknown
	): void => {
		logger.error('Failed to maintain archive object queue', {
			app: 'history-scan-coordinator',
			errorMessage: error instanceof Error ? error.message : String(error),
			maintenanceWork
		});
	};

	let proofRefreshForceRequested = false;
	let proofRefreshRerunRequested = false;
	let proofRefreshRunning = false;
	let transitionForceRequested = false;
	let transitionRerunRequested = false;
	let transitionRunning = false;
	let executionForceRequested = false;
	let executionRerunRequested = false;
	let executionRunning = false;

	const runProofRefresh = async (): Promise<void> => {
		if (proofRefreshRunning) {
			proofRefreshRerunRequested = true;
			return;
		}
		proofRefreshRunning = true;
		try {
			do {
				proofRefreshRerunRequested = false;
				const force = proofRefreshForceRequested;
				proofRefreshForceRequested = false;
				try {
					const completedProofs =
						(await reconciler.executeTargetedProofRefreshIfDue(
							Date.now(),
							force
						)) ?? 0;
					if (completedProofs > 0 && !stopped) {
						// Proof refresh atomically materializes the next compact
						// checkpoint plan. Keep draining without starting the
						// expensive global recovery lanes after every proof wave.
						proofRefreshForceRequested = true;
						proofRefreshRerunRequested = true;
					} else if (!stopped) {
						requestTransitions(force);
						requestExecutionDisposition(force);
					}
				} catch (error: unknown) {
					logFailure('proof refresh', error);
				}
			} while (proofRefreshRerunRequested && !stopped);
		} finally {
			proofRefreshRunning = false;
			if (proofRefreshRerunRequested && !stopped) void runProofRefresh();
		}
	};

	const requestProofRefresh = (force = false): void => {
		proofRefreshForceRequested ||= force;
		proofRefreshRerunRequested = true;
		void runProofRefresh();
	};

	const runTransitions = async (): Promise<void> => {
		if (transitionRunning) {
			transitionRerunRequested = true;
			return;
		}
		transitionRunning = true;
		try {
			do {
				transitionRerunRequested = false;
				const force = transitionForceRequested;
				transitionForceRequested = false;
				try {
					await reconciler.executeTransitionReconciliationIfDue(
						Date.now(),
						{},
						force
					);
				} catch (error: unknown) {
					logFailure('transitions', error);
				}
			} while (transitionRerunRequested && !stopped);
		} finally {
			transitionRunning = false;
			if (transitionRerunRequested && !stopped) void runTransitions();
		}
	};

	const requestTransitions = (force = false): void => {
		transitionForceRequested ||= force;
		transitionRerunRequested = true;
		void runTransitions();
	};

	const runExecutionDisposition = async (): Promise<void> => {
		if (executionRunning) {
			executionRerunRequested = true;
			return;
		}
		executionRunning = true;
		try {
			do {
				executionRerunRequested = false;
				const force = executionForceRequested;
				executionForceRequested = false;
				try {
					const cursorAdvances =
						(await reconciler.executeExecutionDispositionReconciliationIfDue(
							Date.now(),
							force
						)) ?? 0;
					if (cursorAdvances > 0 && !stopped) {
						executionForceRequested = true;
						executionRerunRequested = true;
						requestProofRefresh(true);
						requestTransitions(true);
					}
				} catch (error: unknown) {
					logFailure('execution disposition', error);
				}
			} while (executionRerunRequested && !stopped);
		} finally {
			executionRunning = false;
			if (executionRerunRequested && !stopped) {
				void runExecutionDisposition();
			}
		}
	};

	const requestExecutionDisposition = (force = false): void => {
		executionForceRequested ||= force;
		executionRerunRequested = true;
		void runExecutionDisposition();
	};

	const requestMaintenance = (force = false): void => {
		requestProofRefresh(force);
	};

	const onProofRefreshWake = (message: unknown): void => {
		if (!isHistoryArchiveProofRefreshWakeMessage(message)) return;
		requestMaintenance(true);
	};
	process.on('message', onProofRefreshWake);

	const maintenanceTimer = setInterval(
		() => requestMaintenance(),
		Math.min(
			intervals.transitionReconciliationIntervalMs,
			intervals.executionAdmissionIntervalMs
		)
	);
	maintenanceTimer.unref();
	requestMaintenance(true);

	return () => {
		stopped = true;
		clearInterval(maintenanceTimer);
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
