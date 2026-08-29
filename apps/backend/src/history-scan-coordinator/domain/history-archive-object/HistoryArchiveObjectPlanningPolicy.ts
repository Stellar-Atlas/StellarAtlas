import { availableParallelism } from 'node:os';
import { resolveHistoryArchiveObjectWorkerCapacity } from 'history-scanner-dto';

const historyArchiveWorkerCapacity = resolveHistoryArchiveObjectWorkerCapacity(
	process.env,
	availableParallelism()
);

export const historyArchiveConsumerCount =
	historyArchiveWorkerCapacity.consumerCount;
// A checkpoint normally fans out to about four immediately downloadable core
// objects. Keep a natural 64-checkpoint (4,096-ledger) window so the configured
// worker pool can remain fed without admitting a second archive root.
export const historyArchiveSequentialPrefetchDepth = Math.max(
	64,
	Math.ceil(historyArchiveConsumerCount / 4)
);
export const historyArchiveCanonicalReserveCount =
	historyArchiveWorkerCapacity.canonicalReserveCount;
export const historyArchivePerHostConcurrency = historyArchiveConsumerCount;
export const historyArchiveMinimumWatermark =
	historyArchiveWorkerCapacity.minimumWatermark;
export const historyArchiveMaximumWatermark =
	historyArchiveWorkerCapacity.maximumWatermark;
export const historyArchivePerRootFrontier = historyArchiveConsumerCount;
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
