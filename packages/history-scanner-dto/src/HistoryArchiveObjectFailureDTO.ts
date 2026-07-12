export const historyArchiveObjectFailureChannels = [
	'archive_evidence',
	'scanner_issue'
] as const;

export type HistoryArchiveObjectFailureChannelDTO =
	(typeof historyArchiveObjectFailureChannels)[number];

export function isHistoryArchiveObjectFailureChannelDTO(
	value: unknown
): value is HistoryArchiveObjectFailureChannelDTO {
	return historyArchiveObjectFailureChannels.some(
		(channel) => channel === value
	);
}
