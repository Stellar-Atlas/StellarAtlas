export const historyArchiveConsumerCount = 24;
export const historyArchiveMinimumWatermark = historyArchiveConsumerCount * 2;
export const historyArchiveMaximumWatermark = historyArchiveConsumerCount * 10;
export const historyArchivePerRootFrontier = 8;
export const historyArchiveThroughputWindowMinutes = 15;
const targetBacklogMinutes = 10;
export const historyArchiveThroughputSampleCap = Math.ceil(
	(historyArchiveMaximumWatermark * historyArchiveThroughputWindowMinutes) /
		targetBacklogMinutes
);

export interface HistoryArchivePlanningPressure {
	readonly availableSlots: number;
	readonly outstandingObjects: number;
	readonly recentCompletions: number;
	readonly watermark: number;
}

export function calculateHistoryArchivePlanningPressure(input: {
	readonly outstandingObjects: number;
	readonly recentCompletions: number;
}): HistoryArchivePlanningPressure {
	const outstandingObjects = normalizeCount(input.outstandingObjects);
	const recentCompletions = normalizeCount(input.recentCompletions);
	const watermark = historyArchiveMinimumWatermark;

	return {
		availableSlots: Math.max(0, watermark - outstandingObjects),
		outstandingObjects,
		recentCompletions,
		watermark
	};
}

function normalizeCount(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) return 0;
	return value;
}
