import type { Logger } from 'logger';

// Ephemeral diagnostics only: no worker-registry or per-job database writes.
export function createArchiveMaintenanceReporter(
	logger: Pick<Logger, 'warn'>,
	now: () => number = Date.now
): (code: string) => void {
	let nextReportAt = 0;
	let deferredSinceReport = 0;
	return (code) => {
		deferredSinceReport++;
		const time = now();
		if (time < nextReportAt) return;
		logger.warn('Archive dispatcher maintenance deferred after rollback', {
			sqlState: code,
			deferredSinceReport,
			action: 'Return to ready-job publication; retry maintenance when needed'
		});
		deferredSinceReport = 0;
		nextReportAt = time + 60_000;
	};
}
