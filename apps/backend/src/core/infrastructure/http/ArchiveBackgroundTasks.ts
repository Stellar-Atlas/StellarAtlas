import type Kernel from '../Kernel.js';
import { DataSource } from 'typeorm';
import type { Logger } from 'logger';
import {
	parseHistoryArchiveMaintenanceIntervalMs,
	startHistoryArchiveMaintenanceLoop
} from '@history-scan-coordinator/use-cases/reconcile-history-archive-object-transitions/HistoryArchiveMaintenanceLoop.js';
import { ReconcileHistoryArchiveObjectTransitions } from '@history-scan-coordinator/use-cases/reconcile-history-archive-object-transitions/ReconcileHistoryArchiveObjectTransitions.js';
import { startKnownArchiveFailureSummaryRefresh } from '@history-scan-coordinator/infrastructure/repositories/database/KnownArchiveFailureSummaryRefresh.js';

/** One authoritative writer; read-only API children never start these loops. */
export function startArchiveBackgroundTasks(kernel: Kernel): () => void {
	if (
		process.env.API_HISTORY_MAINTENANCE_WRITER !== 'true' ||
		process.env.API_HISTORY_MAINTENANCE_ENABLED === 'false'
	)
		return () => undefined;
	const logger = kernel.container.get<Logger>('Logger');
	const stopMaintenance = startHistoryArchiveMaintenanceLoop(
		kernel.container.get(ReconcileHistoryArchiveObjectTransitions),
		logger,
		parseHistoryArchiveMaintenanceIntervalMs(
			process.env.API_HISTORY_MAINTENANCE_INTERVAL_MS
		)
	);
	const stopSummaries = startKnownArchiveFailureSummaryRefresh(
		kernel.container.get(DataSource),
		logger
	);
	return () => {
		stopSummaries();
		stopMaintenance();
	};
}
