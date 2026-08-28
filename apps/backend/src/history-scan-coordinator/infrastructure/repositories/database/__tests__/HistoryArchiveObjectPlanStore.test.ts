import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { deduplicateHistoryArchiveObjects } from '../HistoryArchiveObjectPlanStore.js';

describe('history archive plan input deduplication', () => {
	it('collapses repeated root/type/key entries and preserves ready work', () => {
		const archiveUrl = 'https://duplicate-fanout.example/history';
		const waiting = bucketObject(archiveUrl, false);
		const ready = bucketObject(archiveUrl, true);
		const otherRoot = bucketObject(
			'https://other-fanout.example/history',
			true
		);

		const deduplicated = deduplicateHistoryArchiveObjects([
			waiting,
			ready,
			otherRoot
		]);

		expect(deduplicated).toHaveLength(2);
		expect(deduplicated[0]).toBe(ready);
		expect(deduplicated[1]).toBe(otherRoot);
	});
});

function bucketObject(
	archiveUrl: string,
	dependencyReady: boolean
): HistoryArchiveObject {
	const bucketHash = 'a'.repeat(64);
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		dependencyReady,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket-${bucketHash}.xdr.gz`
	});
}
