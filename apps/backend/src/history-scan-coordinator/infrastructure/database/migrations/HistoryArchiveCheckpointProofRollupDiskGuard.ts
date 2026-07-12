const rootReserveBytes = 8n * 1024n * 1024n * 1024n;
const baseFinalBytes = 16n * 1024n * 1024n;
const estimatedBytesPerArchive = 4n * 1024n;
const migrationSafetyBytes = 64n * 1024n * 1024n;

export interface HistoryArchiveCheckpointProofRollupDiskEstimate {
	readonly archiveCount: bigint;
	readonly estimatedFinalBytes: bigint;
	readonly estimatedPeakBytes: bigint;
	readonly requiredFreeBytes: bigint;
	readonly rootReserveBytes: bigint;
}

export function estimateCheckpointProofRollupDisk(
	archiveCount: bigint,
	batchSize: number
): HistoryArchiveCheckpointProofRollupDiskEstimate {
	if (archiveCount < 0n) throw new Error('Archive count cannot be negative');
	const boundedBatchWorkingBytes = BigInt(batchSize) * 512n;
	const estimatedFinalBytes =
		baseFinalBytes + archiveCount * estimatedBytesPerArchive;
	const estimatedPeakBytes =
		estimatedFinalBytes * 2n + boundedBatchWorkingBytes + migrationSafetyBytes;
	return {
		archiveCount,
		estimatedFinalBytes,
		estimatedPeakBytes,
		requiredFreeBytes: estimatedPeakBytes + rootReserveBytes,
		rootReserveBytes
	};
}

export function assertCheckpointProofRollupDiskAvailable(
	estimate: HistoryArchiveCheckpointProofRollupDiskEstimate,
	availableBytes: bigint
): void {
	if (availableBytes >= estimate.requiredFreeBytes) return;
	throw new Error(
		'Checkpoint proof rollup migration disk guard failed: ' +
			`final=${estimate.estimatedFinalBytes}, peak=${estimate.estimatedPeakBytes}, ` +
			`reserve=${estimate.rootReserveBytes}, available=${availableBytes}`
	);
}
