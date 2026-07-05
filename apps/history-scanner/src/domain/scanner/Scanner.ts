import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import { Scan } from '../scan/Scan.js';
import type { ExceptionLogger } from 'exception-logger';
import { RangeScanner } from './RangeScanner.js';
import { ScanJob } from '../scan/ScanJob.js';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';
import { ScanSettingsFactory } from '../scan/ScanSettingsFactory.js';
import { ScanSettings } from '../scan/ScanSettings.js';
import { ScanResult } from '../scan/ScanResult.js';
import { Url } from 'http-helper';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { noopParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import type { ParsedHistorySink } from './parsed-history/ParsedHistorySink.js';

export interface LedgerHeader {
	ledger: number;
	hash?: string;
}

@injectable()
export class Scanner {
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
		parsedHistorySink: ParsedHistorySink = noopParsedHistorySink
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

		const scanResult = await this.scanInRanges(
			scanJob.url,
			scanSettings,
			parsedHistorySink
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
		parsedHistorySink: ParsedHistorySink
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
		let error: ScanError | undefined;
		const errors: ScanError[] = [];
		let previousRangeHeader: LedgerHeader = {
			ledger: latestLedgerHeader.ledger,
			hash: latestLedgerHeader.hash
		};
		let hasUnverifiedGap = false;

		while (rangeFromLedger < scanSettings.toLedger) {
			const rangeTimer = Scanner.createTimerLabel(
				`range_scan:${rangeFromLedger}-${rangeToLedger}`
			);
			console.time(rangeTimer);
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

			if (rangeResult.isErr()) {
				const rangeErrors = this.expandScanError(rangeResult.error);
				error = error ?? rangeErrors[0] ?? rangeResult.error;
				errors.push(...rangeErrors);
				hasUnverifiedGap = true;
				previousRangeHeader = {
					ledger: rangeToLedger,
					hash: undefined
				};
				if (this.isArchiveAccessDeniedError(rangeResult.error)) break;
			} else {
				if (rangeResult.value.errors.length > 0) {
					error = error ?? rangeResult.value.errors[0];
					errors.push(...rangeResult.value.errors);
					hasUnverifiedGap = true;
				} else if (!hasUnverifiedGap) {
					latestLedgerHeader.ledger = rangeResult.value.latestLedgerHeader
						? rangeResult.value.latestLedgerHeader.ledger
						: rangeToLedger;
					latestLedgerHeader.hash = rangeResult.value.latestLedgerHeader?.hash;
				}

				alreadyScannedBucketHashes = rangeResult.value.scannedBucketHashes;
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
			error,
			errors
		};
	}

	private expandScanError(error: ScanError): readonly ScanError[] {
		return error.relatedErrors.length > 0 ? error.relatedErrors : [error];
	}

	private isArchiveAccessDeniedError(error: ScanError): boolean {
		const errors = this.expandScanError(error);
		return errors.some(
			(scanError) =>
				scanError.type === ScanErrorType.TYPE_VERIFICATION &&
				/^HTTP 40[13](\s|$)/.test(scanError.message)
		);
	}

	private static createTimerLabel(name: string): string {
		return `${name}:${process.pid}:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
	}
}
