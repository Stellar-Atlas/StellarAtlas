import 'reflect-metadata';
import { ScanError, ScanErrorType } from './ScanError.js';
import { injectable } from 'inversify';
import { ScanJob } from './ScanJob.js';
import { err, ok, Result } from 'neverthrow';
import { CategoryScanner } from '../scanner/CategoryScanner.js';
import { ArchivePerformanceTester } from '../scanner/ArchivePerformanceTester.js';
import { ScanSettings } from './ScanSettings.js';

@injectable()
export class ScanSettingsFactory {
	constructor(
		private categoryScanner: CategoryScanner,
		private archivePerformanceTester: ArchivePerformanceTester,
		private slowArchiveMaxNumberOfLedgersToScan = 120960, //by default only scan the latest week worth of ledgers for slow archives (5sec ledger close time)
		private fallbackConcurrency = 24,
		private maxConcurrency = 24
	) {}

	async determineSettings(
		scanJob: ScanJob
	): Promise<Result<ScanSettings, ScanError>> {
		const toLedgerResult = await this.determineToLedger(scanJob);
		if (toLedgerResult.isErr()) {
			return err(toLedgerResult.error);
		}
		const {
			ledger: toLedger,
			archiveMetadata,
			errors: settingsErrors
		} = toLedgerResult.value;

		const concurrencyResult = await this.determineConcurrencyAndSlowArchive(
			scanJob,
			toLedger
		);

		if (concurrencyResult.isErr()) {
			return err(concurrencyResult.error);
		}

		const concurrency = concurrencyResult.value.concurrency;
		const isSlowArchive = concurrencyResult.value.isSlowArchive;

		const fromLedger = this.determineFromLedger(
			scanJob,
			toLedger,
			isSlowArchive
		);

		const latestLedgerHeader = this.determineLatestLedgerHeader(
			scanJob,
			toLedger,
			isSlowArchive
		);

		return ok(
			ScanSettingsFactory.createScanSettings(
				scanJob,
				toLedger,
				concurrency,
				isSlowArchive,
				fromLedger,
				latestLedgerHeader.ledger,
				latestLedgerHeader.hash,
				archiveMetadata,
				settingsErrors
			)
		);
	}

	private static createScanSettings(
		scanJob: ScanJob,
		toLedger?: number,
		concurrency?: number,
		isSlowArchive?: boolean | null,
		fromLedger?: number,
		latestLedgerHeaderLedger?: number,
		latestLedgerHeaderHash?: string | null,
		archiveMetadata?: ScanSettings['archiveMetadata'],
		errors?: readonly ScanError[]
	): ScanSettings {
		return {
			fromLedger: fromLedger ?? scanJob.fromLedger,
			toLedger: toLedger ?? scanJob.toLedger ?? 0,
			concurrency: concurrency ?? scanJob.concurrency,
			isSlowArchive: isSlowArchive ?? null,
			latestScannedLedger:
				latestLedgerHeaderLedger ?? scanJob.latestScannedLedger,
			latestScannedLedgerHeaderHash:
				latestLedgerHeaderHash !== undefined //careful because it could be null
					? latestLedgerHeaderHash
					: scanJob.latestScannedLedgerHeaderHash,
			archiveMetadata,
			errors
		};
	}

	private async determineConcurrencyAndSlowArchive(
		scanJob: ScanJob,
		toLedger: number
	): Promise<
		Result<{ concurrency: number; isSlowArchive: boolean | null }, ScanError>
	> {
		if (scanJob.concurrency !== 0) {
			return ok({
				concurrency: this.clampConcurrency(scanJob.concurrency),
				isSlowArchive: null
			});
		}

		console.log('determining optimal concurrency');
		const performanceTestResultOrError =
			await this.archivePerformanceTester.test(
				scanJob.url,
				toLedger,
				false,
				this.createPerformanceConcurrencyRange()
			);

		if (performanceTestResultOrError.isErr())
			return ok({
				concurrency: this.clampConcurrency(this.fallbackConcurrency),
				isSlowArchive: null
			});

		console.log(performanceTestResultOrError);
		return ok({
			concurrency: this.clampConcurrency(
				performanceTestResultOrError.value.optimalConcurrency
			),
			isSlowArchive: performanceTestResultOrError.value.isSlowArchive
		});
	}

	private createPerformanceConcurrencyRange(): number[] {
		return [24, 16, 12, 8, 4, 1].filter(
			(concurrency) => concurrency <= this.maxConcurrency
		);
	}

	private clampConcurrency(concurrency: number): number {
		return Math.min(Math.max(concurrency, 1), this.maxConcurrency);
	}

	private determineLatestLedgerHeader(
		scanJob: ScanJob,
		toLedger: number,
		isSlowArchive: boolean | null
	): { ledger: number; hash: string | null } {
		if (
			isSlowArchive &&
			this.slowArchiveExceedsMaxLedgersToScan(toLedger, scanJob)
		)
			return {
				ledger: 0,
				hash: null
			};
		return {
			ledger: scanJob.latestScannedLedger,
			hash: scanJob.latestScannedLedgerHeaderHash
		};
	}

	private determineFromLedger(
		scanJob: ScanJob,
		toLedger: number,
		isSlowArchive: boolean | null
	) {
		if (isSlowArchive)
			return this.slowArchiveExceedsMaxLedgersToScan(toLedger, scanJob)
				? toLedger - this.slowArchiveMaxNumberOfLedgersToScan
				: scanJob.fromLedger;

		return scanJob.fromLedger;
	}

	private slowArchiveExceedsMaxLedgersToScan(
		toLedger: number,
		scanJob: ScanJob
	) {
		return (
			toLedger - scanJob.fromLedger >= this.slowArchiveMaxNumberOfLedgersToScan
		);
	}

	private async determineToLedger(scanJob: ScanJob): Promise<
		Result<
			{
				readonly ledger: number;
				readonly archiveMetadata?: ScanSettings['archiveMetadata'];
				readonly errors?: readonly ScanError[];
			},
			ScanError
		>
	> {
		const latestLedgerOrError = await this.categoryScanner.findLatestLedger(
			scanJob.url
		);

		if (scanJob.toLedger !== null) {
			if (latestLedgerOrError.isErr()) {
				return ok({
					ledger: scanJob.toLedger,
					errors: this.getNonBlockingMetadataErrors(
						latestLedgerOrError.error
					)
				});
			}

			return ok({
				ledger: scanJob.toLedger,
				archiveMetadata: latestLedgerOrError.value.archiveMetadata
			});
		}

		if (latestLedgerOrError.isErr()) {
			return err(latestLedgerOrError.error);
		}

		return ok(latestLedgerOrError.value);
	}

	private getNonBlockingMetadataErrors(
		error: ScanError
	): readonly ScanError[] {
		return error.type === ScanErrorType.TYPE_VERIFICATION ? [error] : [];
	}
}
