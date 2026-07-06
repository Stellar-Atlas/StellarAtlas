import { hashBucketList } from '../hashBucketList.js';
import { getDummyHistoryArchiveState } from '../__fixtures__/getDummyHistoryArchiveState.js';

it('should hash correctly', function () {
	const result = hashBucketList(getDummyHistoryArchiveState());
	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;

	expect(result.value.ledger).toEqual(40351615);
	expect(result.value.hash).toEqual(
		'vtRf4YP8qFhI3d7AtxQsgMM1AJ60P/6e35Brm4UKJPs='
	);
});

it('should include hot archive buckets for version 2 history archive state files', function () {
	const result = hashBucketList({
		version: 2,
		server: 'stellar-core 27.0.0',
		currentLedger: 100,
		currentBuckets: [
			{
				curr: '1'.repeat(64),
				next: { state: 0 },
				snap: '2'.repeat(64)
			},
			{
				curr: '3'.repeat(64),
				next: { state: 0 },
				snap: '0'.repeat(64)
			}
		],
		hotArchiveBuckets: [
			{
				curr: '4'.repeat(64),
				next: { state: 0 },
				snap: '0'.repeat(64)
			},
			{
				curr: '0'.repeat(64),
				next: { state: 0 },
				snap: '0'.repeat(64)
			}
		]
	});
	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;

	expect(result.value.ledger).toEqual(100);
	expect(result.value.hash).toEqual(
		'YpQ9IGMYntuA1HA6aZdisPunHqfzeMcQRBJjr5KyNBA='
	);
});
