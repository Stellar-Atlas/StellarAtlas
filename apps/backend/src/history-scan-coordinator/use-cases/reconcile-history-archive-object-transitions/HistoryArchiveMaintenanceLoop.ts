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
				forceRequested = false;
				const now = Date.now();
				await runWork('transitions', () =>
					reconciler.executeTransitionReconciliationIfDue(now, {}, force)
				);
				let completedProofs = 0;
				try {
					completedProofs =
						(await reconciler.executeTargetedProofRefreshIfDue(
							Date.now(),
							force
						)) ?? 0;
				} catch (error: unknown) {
					await runWork('proof refresh', async () => {
						throw error;
					});
				}
				await runWork('execution disposition', () =>
					reconciler.executeExecutionDispositionReconciliationIfDue(
						Date.now(),
						force
					)
				);
				if (completedProofs > 0) {
					rerunRequested = true;
				}
			} while (rerunRequested && !stopped);
		} finally {
			running = false;
			if (rerunRequested && !stopped) void runMaintenance();
		}
	};

	const requestMaintenance = (force = false): void => {
		forceRequested ||= force;
		rerunRequested = true;
		void runMaintenance();
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
