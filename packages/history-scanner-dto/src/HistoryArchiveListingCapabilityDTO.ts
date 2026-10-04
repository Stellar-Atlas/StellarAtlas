/** Capability scheduling hint only: never evidence that an object/range is absent. */
export interface HistoryArchiveListingCapabilityDTO {
	readonly status: 'supported' | 'unsupported' | 'inconclusive';
	readonly observedAt: string;
}

export function isHistoryArchiveListingCapabilityDTO(
	value: unknown
): value is HistoryArchiveListingCapabilityDTO {
	if (typeof value !== 'object' || value === null) return false;
	return (
		'status' in value &&
		['supported', 'unsupported', 'inconclusive'].includes(
			String(value.status)
		) &&
		'observedAt' in value &&
		typeof value.observedAt === 'string' &&
		Number.isFinite(Date.parse(value.observedAt))
	);
}
