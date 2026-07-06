import { Scanner } from '../Scanner.js';
import { mock } from 'jest-mock-extended';
import { createDummyHistoryBaseUrl } from '../../history-archive/__fixtures__/HistoryBaseUrl.js';
import { err, ok } from 'neverthrow';
import { RangeScanner } from '../RangeScanner.js';
import { ScanError, ScanErrorType } from '../../scan/ScanError.js';
import { ScanJob } from '../../scan/ScanJob.js';
import { ScanSettingsFactory } from '../../scan/ScanSettingsFactory.js';
import { CategoryScanner } from '../CategoryScanner.js';
import { ArchivePerformanceTester } from '../ArchivePerformanceTester.js';
import type { Logger } from 'logger';
import type { ExceptionLogger } from 'exception-logger';

it('should scan', async function () {
	const rangeScanner = mock<RangeScanner>();
	rangeScanner.scan.mockResolvedValue(
		ok({
			latestLedgerHeader: { ledger: 200, hash: 'ledger_hash' },
			scannedBucketHashes: new Set(['a']),
			verifiedBucketHashes: new Set(['a']),
			errors: []
		})
	);

	const scanner = getScanner(rangeScanner);
	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 200, 1);
	const scan = await scanner.perform(new Date(), scanJob);
	expect(scan.latestScannedLedgerHeaderHash).toEqual('ledger_hash');
	expect(scan.latestScannedLedger).toEqual(200);

	expect(rangeScanner.scan).toHaveBeenCalledTimes(2); //three chunks
	expect(rangeScanner.scan).toHaveBeenLastCalledWith(
		{ value: 'https://history0.stellar.org' },
		1,
		200,
		100,
		200,
		'ledger_hash',
		new Set(['a']),
		expect.any(Object)
	);
});

it('should not update latestScannedLedger in case of error', async () => {
	const rangeScanner = mock<RangeScanner>();
	rangeScanner.scan.mockResolvedValue(
		err(new ScanError(ScanErrorType.TYPE_VERIFICATION, 'url', 'message'))
	);
	const scanner = getScanner(rangeScanner);

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 200, 1);
	const scan = await scanner.perform(new Date(), scanJob);

	expect(scan.error?.type).toEqual(ScanErrorType.TYPE_VERIFICATION);
	expect(scan.error?.url).toEqual('url');
	expect(scan.latestScannedLedger).toEqual(0);
	expect(scan.latestScannedLedgerHeaderHash).toEqual(null);
});

it('should preserve all related range scan errors', async () => {
	const rangeScanner = mock<RangeScanner>();
	const firstError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'first-url',
		'first-message'
	);
	const secondError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'second-url',
		'second-message'
	);
	rangeScanner.scan.mockResolvedValue(
		err(
			new ScanError(firstError.type, firstError.url, firstError.message, [
				firstError,
				secondError
			])
		)
	);
	const scanner = getScanner(rangeScanner);

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 50, 1);
	const scan = await scanner.perform(new Date(), scanJob);

	expect(scan.error?.url).toEqual('first-url');
	expect(scan.errors).toEqual([firstError, secondError]);
});

it('should continue scanning after range errors without advancing verified ledger past the gap', async () => {
	const rangeScanner = mock<RangeScanner>();
	const firstError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'first-url',
		'first-message'
	);
	rangeScanner.scan
		.mockResolvedValueOnce(
			ok({
				latestLedgerHeader: { ledger: 100, hash: 'ledger_hash_100' },
				scannedBucketHashes: new Set(['a']),
				verifiedBucketHashes: new Set(['a']),
				errors: [firstError]
			})
		)
		.mockResolvedValueOnce(
			ok({
				latestLedgerHeader: { ledger: 200, hash: 'ledger_hash_200' },
				scannedBucketHashes: new Set(['a', 'b']),
				verifiedBucketHashes: new Set(['a', 'b']),
				errors: []
			})
		);
	const scanner = getScanner(rangeScanner);

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 200, 1);
	const scan = await scanner.perform(new Date(), scanJob);

	expect(rangeScanner.scan).toHaveBeenCalledTimes(2);
	expect(scan.error).toEqual(firstError);
	expect(scan.errors).toEqual([firstError]);
	expect(scan.latestScannedLedger).toEqual(0);
	expect(scan.latestScannedLedgerHeaderHash).toEqual(null);
});

it('should report attempted range progress separately from verified progress', async () => {
	const rangeScanner = mock<RangeScanner>();
	const firstError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'first-url',
		'first-message'
	);
	rangeScanner.scan
		.mockResolvedValueOnce(
			ok({
				latestLedgerHeader: { ledger: 100, hash: 'ledger_hash_100' },
				scannedBucketHashes: new Set(['a']),
				verifiedBucketHashes: new Set(['a']),
				errors: [firstError]
			})
		)
		.mockResolvedValueOnce(
			ok({
				latestLedgerHeader: { ledger: 200, hash: 'ledger_hash_200' },
				scannedBucketHashes: new Set(['a', 'b']),
				verifiedBucketHashes: new Set(['a', 'b']),
				errors: []
			})
		);
	const scanner = getScanner(rangeScanner);
	const progressReports: unknown[] = [];

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 200, 1);
	const scan = await scanner.perform(
		new Date(),
		scanJob,
		undefined,
		async (progress) => {
			progressReports.push(progress);
		}
	);

	expect(scan.latestScannedLedger).toEqual(0);
	expect(progressReports).toEqual([
		{
			concurrency: 1,
			fromLedger: 0,
			toLedger: 200,
			latestScannedLedger: 0,
			latestScannedLedgerHeaderHash: null
		},
		{ currentRangeFromLedger: 0, currentRangeToLedger: 100 },
		{
			currentRangeFromLedger: 0,
			currentRangeToLedger: 100,
			latestAttemptedLedger: 100
		},
		{ currentRangeFromLedger: 100, currentRangeToLedger: 200 },
		{
			currentRangeFromLedger: 100,
			currentRangeToLedger: 200,
			latestAttemptedLedger: 200
		}
	]);
});

it('should stop scanning ranges after archive access is denied', async () => {
	const rangeScanner = mock<RangeScanner>();
	const accessDeniedError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		'https://history.example/history/00/00/00/history-0000003f.json',
		'HTTP 403 Forbidden'
	);
	rangeScanner.scan.mockResolvedValue(err(accessDeniedError));
	const scanner = getScanner(rangeScanner);

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 200, 1);
	const scan = await scanner.perform(new Date(), scanJob);

	expect(rangeScanner.scan).toHaveBeenCalledTimes(1);
	expect(scan.error).toEqual(accessDeniedError);
	expect(scan.errors).toEqual([accessDeniedError]);
	expect(scan.latestScannedLedger).toEqual(0);
	expect(scan.latestScannedLedgerHeaderHash).toEqual(null);
});

it('should cap bucket evidence while preserving unique hashes', async () => {
	const rangeScanner = mock<RangeScanner>();
	const bucketHashes = new Set(
		Array.from({ length: 600 }, (_value, index) =>
			index.toString(16).padStart(64, '0')
		)
	);
	rangeScanner.scan.mockResolvedValue(
		ok({
			latestLedgerHeader: { ledger: 100, hash: 'ledger_hash' },
			scannedBucketHashes: bucketHashes,
			verifiedBucketHashes: bucketHashes,
			errors: []
		})
	);
	const scanner = getScanner(rangeScanner);

	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl(), 0, 100, 1);
	const scan = await scanner.perform(new Date(), scanJob);

	expect(scan.evidence).toHaveLength(500);
	expect(
		new Set(scan.evidence.map((evidence) => evidence.bucketHash)).size
	).toBe(500);
});

function getScanner(rangeScanner: RangeScanner) {
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok({
			ledger: 200,
			archiveMetadata: {
				stellarHistoryUrl:
					'https://history.stellar.org/.well-known/stellar-history.json',
				stellarHistory: {
					version: 1,
					server: 'stellar-core',
					currentLedger: 200,
					currentBuckets: []
				},
				observedAt: '2026-07-05T00:00:00.000Z'
			}
		})
	);

	return new Scanner(
		rangeScanner,
		new ScanSettingsFactory(categoryScanner, mock<ArchivePerformanceTester>()),
		mock<Logger>(),
		mock<ExceptionLogger>(),
		100
	);
}
