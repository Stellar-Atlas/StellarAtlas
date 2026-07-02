import {
	HistoryArchiveState,
	type HistoryStateBucket
} from './HistoryArchiveState.js';

export class HASBucketHashExtractor {
	static getNonZeroHashes(historyArchiveState: HistoryArchiveState): string[] {
		const bucketHashes: string[] = [];
		HASBucketHashExtractor.addBucketHashes(
			bucketHashes,
			historyArchiveState.currentBuckets
		);

		if (historyArchiveState.hotArchiveBuckets !== undefined) {
			HASBucketHashExtractor.addBucketHashes(
				bucketHashes,
				historyArchiveState.hotArchiveBuckets
			);
		}

		return bucketHashes.filter(
			(hash) => !HASBucketHashExtractor.isZeroHash(hash)
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
