import { CheckPointGenerator } from '../../check-point/CheckPointGenerator.js';
import { StandardCheckPointFrequency } from '../../check-point/StandardCheckPointFrequency.js';
import { HttpQueue } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { CategoryScanner } from '../CategoryScanner.js';
import { BucketScanner } from '../BucketScanner.js';
import { RangeScanner } from '../RangeScanner.js';
import type { Logger } from 'logger';
import type { ExceptionLogger } from 'exception-logger';
import { ScanError, ScanErrorType } from '../../scan/ScanError.js';

it('should verify', async function () {
	const checkPointGenerator = new CheckPointGenerator(
		new StandardCheckPointFrequency()
	);

	const categoryScanner = mock<CategoryScanner>();
	const bucketScanner = mock<BucketScanner>();
	categoryScanner.scanHistoryArchiveStateFilesAndReturnBucketHashes.mockResolvedValue(
		ok({
			bucketHashes: new Set(['a', 'b']),
			bucketListHashes: new Map<number, string>(),
			errors: []
		})
	);
	categoryScanner.scanOtherCategories.mockResolvedValue(
		ok({ ledger: 50, hash: 'hash' })
	);
	bucketScanner.scan.mockResolvedValue(
		ok({
			verifiedBucketHashes: new Set(['a', 'b']),
			errors: []
		})
	);

	const httpQueue = mock<HttpQueue>();
	httpQueue.sendRequests.mockResolvedValue(ok(undefined));
	const historyArchiveRangeScanner = new RangeScanner(
		checkPointGenerator,
		categoryScanner,
		bucketScanner,
		httpQueue,
		mock<Logger>(),
		mock<ExceptionLogger>()
	);

	const result = await historyArchiveRangeScanner.scan(
		{ value: 'url' },
		1,
		50,
		0,
		0
	);
	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;
	expect(result.value.latestLedgerHeader?.ledger).toEqual(50);
	expect(result.value.latestLedgerHeader?.hash).toEqual('hash');

	expect(
		categoryScanner.scanHistoryArchiveStateFilesAndReturnBucketHashes
	).toHaveBeenCalledTimes(1); //three chunks
	expect(categoryScanner.scanOtherCategories).toHaveBeenCalledTimes(1); //three chunks
	expect(bucketScanner.scan).toHaveBeenCalledTimes(1);
});

it('should preserve history archive state category and bucket scan errors from the same range', async function () {
	const checkPointGenerator = new CheckPointGenerator(
		new StandardCheckPointFrequency()
	);

	const categoryScanner = mock<CategoryScanner>();
	const bucketScanner = mock<BucketScanner>();
	const hasError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'has-url',
		'has-message'
	);
	categoryScanner.scanHistoryArchiveStateFilesAndReturnBucketHashes.mockResolvedValue(
		ok({
			bucketHashes: new Set(['a', 'b']),
			bucketListHashes: new Map<number, string>(),
			errors: [hasError]
		})
	);
	const categoryError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'category-url',
		'category-message'
	);
	const bucketError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'bucket-url',
		'bucket-message'
	);
	categoryScanner.scanOtherCategories.mockResolvedValue(err(categoryError));
	bucketScanner.scan.mockResolvedValue(err(bucketError));

	const historyArchiveRangeScanner = new RangeScanner(
		checkPointGenerator,
		categoryScanner,
		bucketScanner,
		mock<HttpQueue>(),
		mock<Logger>(),
		mock<ExceptionLogger>()
	);

	const result = await historyArchiveRangeScanner.scan(
		{ value: 'url' },
		1,
		50,
		0,
		0
	);

	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) throw result.error;
	expect(result.value.errors).toEqual([hasError, categoryError, bucketError]);
	expect(bucketScanner.scan).toHaveBeenCalledTimes(1);
});
