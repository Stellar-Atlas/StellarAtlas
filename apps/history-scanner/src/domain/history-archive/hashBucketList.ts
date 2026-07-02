import {
	HistoryArchiveState,
	type HistoryStateBucket
} from './HistoryArchiveState.js';
import { createHash } from 'crypto';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from 'shared';

export function hashBucketList(
	historyArchiveState: HistoryArchiveState
): Result<
	{
		ledger: number;
		hash: string;
	},
	Error
> {
	try {
		const liveBucketListHash = hashBucketLevels(
			historyArchiveState.currentBuckets
		);
		const bucketListHash =
			historyArchiveState.version >= 2 &&
			historyArchiveState.hotArchiveBuckets !== undefined
				? hashJoinedBucketLists(
						liveBucketListHash,
						hashBucketLevels(historyArchiveState.hotArchiveBuckets)
					)
				: liveBucketListHash;

		return ok({
			ledger: historyArchiveState.currentLedger,
			hash: bucketListHash.toString('base64')
		});
	} catch (e) {
		console.log(e);
		return err(mapUnknownToError(e));
	}
}

function hashBucketLevels(buckets: readonly HistoryStateBucket[]): Buffer {
	const bucketListHash = createHash('sha256');
	for (const bucket of buckets) {
		const levelHash = createHash('sha256');
		levelHash.update(Buffer.from(bucket.curr, 'hex'));
		levelHash.update(Buffer.from(bucket.snap, 'hex'));
		bucketListHash.update(levelHash.digest());
	}

	return bucketListHash.digest();
}

function hashJoinedBucketLists(
	liveBucketListHash: Buffer,
	hotArchiveBucketListHash: Buffer
): Buffer {
	const bucketListHash = createHash('sha256');
	bucketListHash.update(liveBucketListHash);
	bucketListHash.update(hotArchiveBucketListHash);

	return bucketListHash.digest();
}
