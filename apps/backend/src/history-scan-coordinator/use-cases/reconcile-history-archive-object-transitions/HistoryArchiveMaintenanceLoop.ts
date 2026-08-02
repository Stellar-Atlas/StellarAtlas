import type { Logger } from 'logger';
import type { ReconcileHistoryArchiveObjectTransitions } from './ReconcileHistoryArchiveObjectTransitions.js';

const maintenanceIntervalMs = 5_000;

export function startHistoryArchiveMaintenanceLoop(
	reconciler: ReconcileHistoryArchiveObjectTransitions,
	logger: Logger
): () => void {
	let running = false;
	let stopped = false;

	const run = async (): Promise<void> => {
		if (running || stopped) return;
		running = true;
		try {
			await reconciler.executeIfDue();
		} catch (error: unknown) {
			logger.error('Failed to maintain archive object queue', {
				app: 'history-scan-coordinator',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => void run(), maintenanceIntervalMs);
	timer.unref();
	void run();

	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
