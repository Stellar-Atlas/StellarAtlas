import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import { Scan } from '../scan/Scan.js';
import type { ExceptionLogger } from 'exception-logger';
import { RangeScanner } from './RangeScanner.js';
import { ScanJob } from '../scan/ScanJob.js';
import { ScanError } from '../scan/ScanError.js';
import { ScanSettingsFactory } from '../scan/ScanSettingsFactory.js';
import { ScanSettings } from '../scan/ScanSettings.js';
import { ScanResult } from '../scan/ScanResult.js';
import { Url } from 'http-helper';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { noopParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import type { ParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import { UrlBuilder } from '../history-archive/UrlBuilder.js';
import type { ScanEvidenceDTO } from 'history-scanner-dto';
import {
	ArchiveScanErrorAccumulator,
	expandScanError,
	isArchiveAccessDeniedError
} from './ArchiveScanErrorAccumulator.js';

export interface LedgerHeader {
	ledger: number;
	hash?: string;
}

export interface ScanProgressReport {
	readonly concurrency?: number;
	readonly currentRangeFromLedger?: number | null;
	readonly currentRangeToLedger?: number | null;
	readonly fromLedger?: number;
	readonly latestAttemptedLedger?: number;
	readonly latestScannedLedger?: number;
	readonly latestScannedLedgerHeaderHash?: string | null;
	readonly toLedger?: number | null;
}

export type ScanProgressReporter = (
	progress: ScanProgressReport
) => Promise<void>;

@injectable()
export class Scanner {
	private static readonly maxBucketEvidenceEntries = 500;

	constructor(
		private rangeScanner: RangeScanner,
		private scanJobSettingsFactory: ScanSettingsFactory,
		@inject('Logger') private logger: Logger,
		@inject(TYPES.ExceptionLogger) private exceptionLogger: ExceptionLogger,
		private readonly rangeSize = 1000000
	) {}

	async perform(
		time: Date,
		scanJob: ScanJob,
		parsedHistorySink: ParsedHistorySink = noopParsedHistorySink,
		reportProgress?: ScanProgressReporter
	): Promise<Scan> {
		const scanTimer = Scanner.createTimerLabel('scan');
		console.time(scanTimer);

		this.logger.info('Starting scan', {
			url: scanJob.url.value,
			isStartOfChain: scanJob.isNewScanChainJob(),
			chainInitDate: scanJob.chainInitDate
		});

		const scanSettingsOrError =
			await this.scanJobSettingsFactory.determineSettings(scanJob);

		if (scanSettingsOrError.isErr()) {
			const error = scanSettingsOrError.error;
			return scanJob.createFailedScanCouldNotDetermineSettings(
				time,
				new Date(),
				error
			);
		}

		const scanSettings = scanSettingsOrError.value;

		this.logger.info('Scan settings', {
			url: scanJob.url.value,
			fromLedger: scanSettings.fromLedger,
			toLedger: scanSettings.toLedger,
			concurrency: scanSettings.concurrency,
			isSlowArchive: scanSettings.isSlowArchive
		});
		await reportProgress?.(Scanner.mapSettingsToProgress(scanSettings));

		const scanResult = await this.scanInRanges(
			scanJob.url,
			scanSettings,
			parsedHistorySink,
			reportProgress
		);
		const scan = scanJob.createScanFromScanResult(
			time,
			new Date(),
			scanSettings,
			scanResult
		);
		console.timeEnd(scanTimer);

		return scan;
	}

	private async scanInRanges(
		url: Url,
		scanSettings: ScanSettings,
		parsedHistorySink: ParsedHistorySink,
		reportProgress?: ScanProgressReporter
	): Promise<ScanResult> {
		const latestLedgerHeader: LedgerHeader = {
			ledger: scanSettings.latestScannedLedger,
			hash: scanSettings.latestScannedLedgerHeaderHash ?? undefined
		};

		let rangeFromLedger = scanSettings.fromLedger; //todo move to range generator
		let rangeToLedger =
			rangeFromLedger + this.rangeSize < scanSettings.toLedger
				? rangeFromLedger + this.rangeSize
				: scanSettings.toLedger;

		let alreadyScannedBucketHashes = new Set<string>();
		const verifiedBucketHashes = new Set<string>();
		const scanErrors = new ArchiveScanErrorAccumulator();
		let previousRangeHeader: LedgerHeader = {
			ledger: latestLedgerHeader.ledger,
			hash: latestLedgerHeader.hash
		};
		let hasUnverifiedGap = Scanner.hasInitialUnverifiedGap(scanSettings);

		while (rangeFromLedger < scanSettings.toLedger) {
			const rangeTimer = Scanner.createTimerLabel(
				`range_scan:${rangeFromLedger}-${rangeToLedger}`
			);
			console.time(rangeTimer);
			await reportProgress?.({
				currentRangeFromLedger: rangeFromLedger,
				currentRangeToLedger: rangeToLedger
			});
			const rangeResult = await this.rangeScanner.scan(
				url,
				scanSettings.concurrency,
				rangeToLedger,
				rangeFromLedger,
				previousRangeHeader.ledger,
				previousRangeHeader.hash ?? null,
				alreadyScannedBucketHashes,
				parsedHistorySink
			);
			console.timeEnd(rangeTimer);
			await reportProgress?.({
				currentRangeFromLedger: rangeFromLedger,
				currentRangeToLedger: rangeToLedger,
				latestAttemptedLedger: rangeToLedger
			});

			if (rangeResult.isErr()) {
				const rangeErrors = this.expandScanError(rangeResult.error);
				scanErrors.addMany(rangeErrors);
				hasUnverifiedGap = true;
				previousRangeHeader = {
					ledger: rangeToLedger,
					hash: undefined
				};
				if (this.isArchiveAccessDeniedError(rangeResult.error)) break;
			} else {
				if (rangeResult.value.errors.length > 0) {
					scanErrors.addMany(rangeResult.value.errors);
					hasUnverifiedGap = true;
				} else if (!hasUnverifiedGap) {
					latestLedgerHeader.ledger = rangeResult.value.latestLedgerHeader
						? rangeResult.value.latestLedgerHeader.ledger
						: rangeToLedger;
					latestLedgerHeader.hash = rangeResult.value.latestLedgerHeader?.hash;
				}

				alreadyScannedBucketHashes = rangeResult.value.scannedBucketHashes;
				for (const bucketHash of rangeResult.value.verifiedBucketHashes) {
					verifiedBucketHashes.add(bucketHash);
				}
				previousRangeHeader = rangeResult.value.latestLedgerHeader
					? {
							ledger: rangeResult.value.latestLedgerHeader.ledger,
							hash: rangeResult.value.latestLedgerHeader.hash
						}
					: {
							ledger: rangeToLedger,
							hash: undefined
						};
			}

			rangeFromLedger += this.rangeSize;
			rangeToLedger =
				rangeFromLedger + this.rangeSize < scanSettings.toLedger
					? rangeFromLedger + this.rangeSize
					: scanSettings.toLedger;
		}

		return {
			latestLedgerHeader,
			error: scanErrors.first,
			errors: scanErrors.values,
			evidence: this.createBucketEvidence(url, verifiedBucketHashes)
		};
	}

	private createBucketEvidence(
		baseUrl: Url,
		bucketHashes: ReadonlySet<string>
	): readonly ScanEvidenceDTO[] {
		return Array.from(bucketHashes)
			.sort()
			.slice(0, Scanner.maxBucketEvidenceEntries)
			.map((bucketHash) => ({
				bucketHash,
				kind: 'bucket',
				status: 'verified',
				url: UrlBuilder.getBucketUrl(baseUrl, bucketHash).value
			}));
	}

	private expandScanError(error: ScanError): readonly ScanError[] {
		return expandScanError(error);
	}

	private isArchiveAccessDeniedError(error: ScanError): boolean {
		return isArchiveAccessDeniedError(error);
	}

	private static createTimerLabel(name: string): string {
		return `${name}:${process.pid}:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
	}

	private static mapSettingsToProgress(
		scanSettings: ScanSettings
	): ScanProgressReport {
		return {
			concurrency: scanSettings.concurrency,
			fromLedger: scanSettings.fromLedger,
			toLedger: scanSettings.toLedger,
			latestScannedLedger: scanSettings.latestScannedLedger,
			latestScannedLedgerHeaderHash: scanSettings.latestScannedLedgerHeaderHash
		};
	}

	private static hasInitialUnverifiedGap(scanSettings: ScanSettings): boolean {
		return scanSettings.fromLedger > scanSettings.latestScannedLedger + 1;
	}
}
