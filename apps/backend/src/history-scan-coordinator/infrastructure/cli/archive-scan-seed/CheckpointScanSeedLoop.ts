import type { CheckpointScanSeedResult } from '../../repositories/database/HistoryArchiveCheckpointScanSeed.js';
import type { CheckpointScanSeedCliOptions } from './CheckpointScanSeedCliOptions.js';

export interface CheckpointScanSeedProgress extends CheckpointScanSeedResult {
	readonly chunksCompleted: number;
	readonly elapsedMs: number;
}

/** Serial bounded transactions; only the current result is retained in memory. */
export async function runCheckpointScanSeedLoop(
	options: CheckpointScanSeedCliOptions,
	nextChunk: () => Promise<CheckpointScanSeedResult>,
	write: (progress: CheckpointScanSeedProgress) => void,
	now: () => number = Date.now
): Promise<{ readonly chunksCompleted: number; readonly complete: boolean }> {
	const startedAt = now();
	const deadline = startedAt + options.durationMs;
	let chunks = 0;
	let lastLoggedChunk = 0;
	let previousSource: CheckpointScanSeedResult['source'] | undefined;
	let last: CheckpointScanSeedResult | undefined;
	const report = (progress: CheckpointScanSeedResult): void => {
		write({
			...progress,
			chunksCompleted: chunks,
			elapsedMs: Math.max(0, now() - startedAt)
		});
		lastLoggedChunk = chunks;
	};
	while (
		options.untilComplete ||
		(chunks < options.chunks && now() < deadline)
	) {
		// Errors propagate immediately. The external supervisor owns restart/backoff;
		// no in-process retry can turn a storage stall into a hot query loop.
		const progress = await nextChunk();
		chunks++;
		last = progress;
		if (
			chunks === 1 ||
			previousSource !== progress.source ||
			chunks % 100 === 0 ||
			progress.complete
		)
			report(progress);
		previousSource = progress.source;
		if (progress.complete) return { chunksCompleted: chunks, complete: true };
		if (progress.source === null) {
			if (options.untilComplete) throw new CheckpointScanSeedNotReadyError();
			break;
		}
	}
	if (last !== undefined && lastLoggedChunk !== chunks) report(last);
	return { chunksCompleted: chunks, complete: false };
}

class CheckpointScanSeedNotReadyError extends Error {
	readonly code = 'SEED_READINESS_PENDING';
	constructor() {
		super(
			'No seed source claimable or durable checkpoint floor not reconciled'
		);
	}
}
