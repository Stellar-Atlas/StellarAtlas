export type HistoryArchiveBrokerPriority = 0 | 1 | 2;

export const historyArchiveBrokerMaximumPriorityEnvironmentName =
	'HISTORY_ARCHIVE_BROKER_MAX_PRIORITY';
export const defaultHistoryArchiveBrokerMaximumPriority: HistoryArchiveBrokerPriority = 2;

export function parseHistoryArchiveBrokerMaximumPriority(
	value: string | undefined
): HistoryArchiveBrokerPriority {
	if (value === undefined) return defaultHistoryArchiveBrokerMaximumPriority;
	if (value === '0') return 0;
	if (value === '1') return 1;
	if (value === '2') return 2;
	throw new Error(
		`${historyArchiveBrokerMaximumPriorityEnvironmentName} must be 0, 1, or 2`
	);
}

export function getHistoryArchiveBrokerMaximumPriority(
	environment: NodeJS.ProcessEnv = process.env
): HistoryArchiveBrokerPriority {
	return parseHistoryArchiveBrokerMaximumPriority(
		environment[historyArchiveBrokerMaximumPriorityEnvironmentName]
	);
}
