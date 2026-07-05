export interface HistoryStateBucketDTO {
	readonly curr: string;
	readonly snap: string;
	readonly next: {
		readonly state: number;
		readonly output?: string;
	};
}

export interface HistoryArchiveStateDTO {
	readonly version: number;
	readonly server: string;
	readonly currentLedger: number;
	readonly networkPassphrase?: string;
	readonly currentBuckets: readonly HistoryStateBucketDTO[];
	readonly hotArchiveBuckets?: readonly HistoryStateBucketDTO[];
}

export interface ArchiveMetadataDTO {
	readonly stellarHistoryUrl: string;
	readonly stellarHistory: HistoryArchiveStateDTO;
	readonly observedAt: string;
}

export function isArchiveMetadataDTO(
	value: unknown
): value is ArchiveMetadataDTO {
	if (!isRecord(value)) return false;

	return (
		typeof value.stellarHistoryUrl === 'string' &&
		isHistoryArchiveStateDTO(value.stellarHistory) &&
		typeof value.observedAt === 'string' &&
		!Number.isNaN(new Date(value.observedAt).getTime())
	);
}

function isHistoryArchiveStateDTO(
	value: unknown
): value is HistoryArchiveStateDTO {
	if (!isRecord(value)) return false;

	return (
		typeof value.version === 'number' &&
		Number.isInteger(value.version) &&
		typeof value.server === 'string' &&
		typeof value.currentLedger === 'number' &&
		Number.isInteger(value.currentLedger) &&
		(value.networkPassphrase === undefined ||
			typeof value.networkPassphrase === 'string') &&
		Array.isArray(value.currentBuckets) &&
		value.currentBuckets.every(isHistoryStateBucketDTO) &&
		(value.hotArchiveBuckets === undefined ||
			(Array.isArray(value.hotArchiveBuckets) &&
				value.hotArchiveBuckets.every(isHistoryStateBucketDTO)))
	);
}

function isHistoryStateBucketDTO(
	value: unknown
): value is HistoryStateBucketDTO {
	if (!isRecord(value) || !isRecord(value.next)) return false;

	return (
		typeof value.curr === 'string' &&
		typeof value.snap === 'string' &&
		typeof value.next.state === 'number' &&
		Number.isInteger(value.next.state) &&
		(value.next.output === undefined || typeof value.next.output === 'string')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
