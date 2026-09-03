import { availableParallelism } from 'node:os';
import { resolveHistoryArchiveObjectWorkerCapacity } from 'history-scanner-dto';

const historyArchiveWorkerCapacity = resolveHistoryArchiveObjectWorkerCapacity(
	process.env,
	availableParallelism()
);

export const historyArchiveConsumerCount =
	historyArchiveWorkerCapacity.consumerCount;

// Checkpoint-state discovery is its own network wave before the downloadable
// ledger, transaction, result, SCP, and bucket objects can fan out. Admit at
// least one checkpoint-state per consumer so that first wave can fill the
// configured worker pool when no explicit lookahead is configured.
export function calculateHistoryArchiveSequentialPrefetchDepth(
	consumerCount: number
): number {
	if (!Number.isSafeInteger(consumerCount) || consumerCount < 1) return 64;
	return Math.max(64, consumerCount);
}

export function resolveHistoryArchiveSequentialPrefetchDepth(
	configuredDepth: string | undefined,
	consumerCount: number
): number {
	const fallback =
		calculateHistoryArchiveSequentialPrefetchDepth(consumerCount);
	if (configuredDepth === undefined) return fallback;
	const parsedDepth = Number(configuredDepth);
	if (!Number.isSafeInteger(parsedDepth) || parsedDepth < 1) return fallback;
	return Math.min(parsedDepth, Math.max(1, consumerCount));
}

export const historyArchiveSequentialPrefetchDepth =
	resolveHistoryArchiveSequentialPrefetchDepth(
		process.env.HISTORY_ARCHIVE_SEQUENTIAL_PREFETCH_DEPTH,
		historyArchiveConsumerCount
	);

export function calculateHistoryArchiveCheckpointFanoutBatchSize(
	consumerCount: number
): number {
	if (!Number.isSafeInteger(consumerCount) || consumerCount < 1) return 16;
	return Math.max(16, Math.min(64, Math.ceil(consumerCount / 4)));
}

export const historyArchiveCheckpointFanoutBatchSize =
	calculateHistoryArchiveCheckpointFanoutBatchSize(historyArchiveConsumerCount);
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
