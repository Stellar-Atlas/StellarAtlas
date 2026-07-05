import { CheckPointGenerator } from '../check-point/CheckPointGenerator.js';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import { BucketScanState, CategoryScanState } from './ScanState.js';
import { HttpQueue, Url } from 'http-helper';
import * as http from 'http';
import * as https from 'https';
import { CategoryScanner } from './CategoryScanner.js';
import { BucketScanner } from './BucketScanner.js';
import { ScanError } from '../scan/ScanError.js';
import { LedgerHeader } from './Scanner.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { noopParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import type { ParsedHistorySink } from './parsed-history/ParsedHistorySink.js';

export interface RangeScanResult {
	latestLedgerHeader?: LedgerHeader;
	scannedBucketHashes: Set<string>;
	verifiedBucketHashes: Set<string>;
	errors: readonly ScanError[];
}
/**
 * Scan a specific range of a history archive
 */
@injectable()
export class RangeScanner {
	constructor(
		private checkPointGenerator: CheckPointGenerator,
		private categoryScanner: CategoryScanner,
		private bucketScanner: BucketScanner,
		@inject(TYPES.HttpQueue) private httpQueue: HttpQueue,
		@inject('Logger') private logger: Logger,
		@inject(TYPES.ExceptionLogger) private exceptionLogger: ExceptionLogger
	) {}

	async scan(
		baseUrl: Url,
		concurrency: number,
		toLedger: number,
		fromLedger: number,
		latestScannedLedger: number,
		latestScannedLedgerHeaderHash: string | null = null,
		alreadyScannedBucketHashes = new Set<string>(),
		parsedHistorySink: ParsedHistorySink = noopParsedHistorySink
	): Promise<Result<RangeScanResult, ScanError>> {
		this.logger.info('Starting range scan', {
			history: baseUrl.value,
			toLedger: toLedger,
			fromLedger: fromLedger,
			concurrency: concurrency
		});

		const httpAgent = new http.Agent({
			keepAlive: true,
			maxSockets: concurrency,
			maxFreeSockets: concurrency,
			scheduling: 'fifo'
		});
		const httpsAgent = new https.Agent({
			keepAlive: true,
			maxSockets: concurrency,
			maxFreeSockets: concurrency,
			scheduling: 'fifo'
		});

		const hasScanState = new CategoryScanState(
			baseUrl,
			concurrency,
			httpAgent,
			httpsAgent,
			this.checkPointGenerator.generate(fromLedger, toLedger),
			new Map<number, string>(),
			latestScannedLedgerHeaderHash !== null
				? {
						ledger: latestScannedLedger,
						hash: latestScannedLedgerHeaderHash
					}
				: undefined
		);

		try {
			const bucketHashesOrError =
				await this.scanHASFilesAndReturnBucketHashes(hasScanState);
			if (bucketHashesOrError.isErr()) return err(bucketHashesOrError.error);
			const bucketHashesToScan = bucketHashesOrError.value.bucketHashes;

			const categoryScanState = new CategoryScanState(
				baseUrl,
				concurrency,
				httpAgent,
				httpsAgent,
				this.checkPointGenerator.generate(fromLedger, toLedger),
				bucketHashesOrError.value.bucketListHashes,
				latestScannedLedgerHeaderHash
					? {
							ledger: latestScannedLedger,
							hash: latestScannedLedgerHeaderHash
						}
					: undefined
			);

			const errors: ScanError[] = [];
			let latestLedgerHeader: LedgerHeader | undefined;
			const categoryScanResult = await this.scanCategories(
				categoryScanState,
				parsedHistorySink
			);
			if (categoryScanResult.isErr())
				errors.push(...this.expandScanError(categoryScanResult.error));
			else latestLedgerHeader = categoryScanResult.value;

			const bucketScanState = new BucketScanState(
				baseUrl,
				concurrency,
				httpAgent,
				httpsAgent,
				new Set(
					Array.from(bucketHashesToScan).filter(
						(hashToScan) => !alreadyScannedBucketHashes.has(hashToScan)
					)
				)
			);

			const bucketScanResult = await this.scanBucketFiles(bucketScanState);
			if (bucketScanResult.isErr())
				errors.push(...this.expandScanError(bucketScanResult.error));

			return ok({
				latestLedgerHeader,
				errors,
				scannedBucketHashes: new Set([
					...bucketScanState.bucketHashesToScan,
					...alreadyScannedBucketHashes
				]),
				verifiedBucketHashes: bucketScanResult.isOk()
					? bucketScanResult.value
					: new Set<string>()
			});
		} finally {
			httpAgent.destroy();
			httpsAgent.destroy();
		}
	}

	private async scanHASFilesAndReturnBucketHashes(
		scanState: CategoryScanState
	): Promise<
		Result<
			{
				bucketHashes: Set<string>;
				bucketListHashes: Map<number, string>;
			},
			ScanError
		>
	> {
		this.logger.info('Scanning HAS files');
		const timerLabel = RangeScanner.createTimerLabel('HAS');
		console.time(timerLabel);

		const scanHASResult =
			await this.categoryScanner.scanHASFilesAndReturnBucketHashes(scanState);

		if (scanHASResult.isErr()) {
			return err(scanHASResult.error);
		}

		console.timeEnd(timerLabel);

		return ok(scanHASResult.value);
	}

	private async scanBucketFiles(
		scanState: BucketScanState
	): Promise<Result<Set<string>, ScanError>> {
		const timerLabel = RangeScanner.createTimerLabel('bucket');
		console.time(timerLabel);
		this.logger.info(`Scanning ${scanState.bucketHashesToScan.size} buckets`);

		const scanBucketsResult = await this.bucketScanner.scan(scanState, true);
		console.timeEnd(timerLabel);

		return scanBucketsResult;
	}

	private async scanCategories(
		scanState: CategoryScanState,
		parsedHistorySink: ParsedHistorySink
	): Promise<Result<LedgerHeader | undefined, ScanError>> {
		const timerLabel = RangeScanner.createTimerLabel('category');
		console.time(timerLabel);
		this.logger.info('Scanning other category files');

		const scanOtherCategoriesResult =
			await this.categoryScanner.scanOtherCategories(
				scanState,
				true,
				parsedHistorySink
			);

		console.timeEnd(timerLabel);

		return scanOtherCategoriesResult;
	}

	private expandScanError(error: ScanError): readonly ScanError[] {
		return error.relatedErrors.length > 0 ? error.relatedErrors : [error];
	}

	private static createTimerLabel(name: string): string {
		return `${name}:${process.pid}:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
	}
}
