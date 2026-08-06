export function usesHistoryArchiveBrokerScheduler(
	env: NodeJS.ProcessEnv = process.env
): boolean {
	const mode = env.HISTORY_ARCHIVE_SCHEDULER_MODE?.trim().toLowerCase();
	if (mode === undefined || mode === '' || mode === 'legacy') return false;
	if (mode === 'broker') return true;
	throw new Error(
		'HISTORY_ARCHIVE_SCHEDULER_MODE must be broker or legacy'
	);
}
