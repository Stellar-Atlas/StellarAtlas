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
	let forceRequested = false;
	let proofRefreshRequested = false;
	let rerunRequested = false;
	let running = false;

	const runWork = async (
		maintenanceWork: 'execution disposition' | 'proof refresh' | 'transitions',
		work: () => Promise<void>
	): Promise<void> => {
		try {
			await work();
		} catch (error: unknown) {
			logger.error('Failed to maintain archive object queue', {
				app: 'history-scan-coordinator',
				errorMessage: error instanceof Error ? error.message : String(error),
				maintenanceWork
			});
		}
	};

	const runMaintenance = async (): Promise<void> => {
		if (running) {
			rerunRequested = true;
			return;
		}
		running = true;
		try {
			do {
				rerunRequested = false;
				const force = forceRequested;
				const forceProofRefresh = force || proofRefreshRequested;
				forceRequested = false;
				proofRefreshRequested = false;
				const now = Date.now();
				let completedProofs = 0;
				try {
					completedProofs =
						(await reconciler.executeTargetedProofRefreshIfDue(
							now,
							forceProofRefresh
						)) ?? 0;
				} catch (error: unknown) {
					await runWork('proof refresh', async () => {
						throw error;
					});
				}
				await runWork('transitions', () =>
					reconciler.executeTransitionReconciliationIfDue(now, {}, force)
				);
				await runWork('execution disposition', () =>
					reconciler.executeExecutionDispositionReconciliationIfDue(
						Date.now(),
						force
					)
				);
				if (completedProofs > 0) {
					proofRefreshRequested = true;
					rerunRequested = true;
				}
			} while (rerunRequested && !stopped);
		} finally {
			running = false;
			if (rerunRequested && !stopped) void runMaintenance();
		}
	};

	const requestMaintenance = (
		force = false,
		forceProofRefresh = false
	): void => {
		forceRequested ||= force;
		proofRefreshRequested ||= forceProofRefresh;
		rerunRequested = true;
		void runMaintenance();
	};

	const onProofRefreshWake = (message: unknown): void => {
		if (!isHistoryArchiveProofRefreshWakeMessage(message)) return;
		requestMaintenance(true, true);
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
