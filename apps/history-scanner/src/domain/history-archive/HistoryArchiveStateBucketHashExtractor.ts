import {
	HistoryArchiveState,
	type HistoryStateBucket
} from './HistoryArchiveState.js';

export class HistoryArchiveStateBucketHashExtractor {
	static getNonZeroHashes(historyArchiveState: HistoryArchiveState): string[] {
		const bucketHashes: string[] = [];
		HistoryArchiveStateBucketHashExtractor.addBucketHashes(
			bucketHashes,
			historyArchiveState.currentBuckets
		);

		if (historyArchiveState.hotArchiveBuckets !== undefined) {
			HistoryArchiveStateBucketHashExtractor.addBucketHashes(
				bucketHashes,
				historyArchiveState.hotArchiveBuckets
			);
		}

		return bucketHashes.filter(
			(hash) => !HistoryArchiveStateBucketHashExtractor.isZeroHash(hash)
		);
	}

	private static addBucketHashes(
		bucketHashes: string[],
		buckets: readonly HistoryStateBucket[]
	): void {
		for (const bucket of buckets) {
			bucketHashes.push(bucket.curr);
			bucketHashes.push(bucket.snap);

			const nextOutput = bucket.next.output;
			if (nextOutput) bucketHashes.push(nextOutput);
		}
	}

	private static isZeroHash(hash: string) {
		return parseInt(hash, 16) === 0;
	}
}
