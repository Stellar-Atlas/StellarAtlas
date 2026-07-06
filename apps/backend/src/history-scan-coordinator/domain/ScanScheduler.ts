import { sortHistoryUrls } from './sortHistoryUrls.js';
import { Scan } from './scan/Scan.js';
import { ScanJob } from './ScanJob.js';
import { extractLedgerFromHistoryArchiveUrl } from './scan/extractLedgerFromHistoryArchiveUrl.js';
import { ScanErrorType } from './scan/ScanError.js';
import {
	getHistoryArchiveUrlIdentity,
	uniqueHistoryArchiveUrls
} from './ArchiveUrlIdentity.js';

export interface ScanScheduler {
	schedule(
		archives: string[],
		previousScans: Scan[],
		unfinishedScanJobs: ScanJob[],
		options?: ScanSchedulerOptions
	): ScanJob[];
}

export interface ScanSchedulerOptions {
	includeRegularJobs: boolean;
}

export class RestartAtLeastOneScan implements ScanScheduler {
	private static readonly defaultMaxConcurrency = 24;
	private static readonly defaultArchiveErrorRecheckIntervalMs =
		24 * 60 * 60 * 1000;

	constructor(
		private readonly maxConcurrency = RestartAtLeastOneScan.defaultMaxConcurrency,
		private readonly archiveErrorRecheckIntervalMs = RestartAtLeastOneScan.defaultArchiveErrorRecheckIntervalMs,
		private readonly now = () => new Date()
	) {}

	schedule(
		archives: string[],
		previousScans: Scan[],
		unfinishedScanJobs: ScanJob[] = [],
		options: ScanSchedulerOptions = { includeRegularJobs: true }
	): ScanJob[] {
		const uniqueArchives = uniqueHistoryArchiveUrls(archives);
		const unfinishedUrlIdentities = new Set(
			unfinishedScanJobs
				.map((job) => getHistoryArchiveUrlIdentity(job.url))
				.filter((identity): identity is string => identity !== null)
		);
		const unfinishedErrorRecheckUrls = new Set(
			unfinishedScanJobs
				.filter((job) => job.fromLedger !== null || job.toLedger !== null)
				.map((job) => getHistoryArchiveUrlIdentity(job.url))
				.filter((identity): identity is string => identity !== null)
		);
		const previousScansMap = new Map(
			previousScans.map((scan) => {
				return [
					getHistoryArchiveUrlIdentity(scan.baseUrl.value) ??
						scan.baseUrl.value,
					scan
				];
			})
		);
		const archivesReadyForErrorRecheck = uniqueArchives.filter(
			(archive) =>
				!unfinishedErrorRecheckUrls.has(
					getHistoryArchiveUrlIdentity(archive) ?? archive
				)
		);
		const errorRecheckJobs = archivesReadyForErrorRecheck
			.map((archive) =>
				previousScansMap.get(getHistoryArchiveUrlIdentity(archive) ?? archive)
			)
			.filter(
				(scan): scan is Scan =>
					scan !== undefined &&
					scan.hasArchiveVerificationError() &&
					this.isArchiveErrorRecheckDue(scan)
			)
			.map((scan) => this.createErrorRecheckJob(scan));

		if (!options.includeRegularJobs) return errorRecheckJobs;
		const errorRecheckUrlIdentities = new Set(
			errorRecheckJobs
				.map((job) => getHistoryArchiveUrlIdentity(job.url))
				.filter((identity): identity is string => identity !== null)
		);
		const archivesReadyForRegularScan = uniqueArchives.filter((archive) => {
			const identity = getHistoryArchiveUrlIdentity(archive) ?? archive;
			return (
				!unfinishedUrlIdentities.has(identity) &&
				!errorRecheckUrlIdentities.has(identity)
			);
		});

		const archivesSortedByInitDate = sortHistoryUrls(
			archivesReadyForRegularScan,
			new Map(
				previousScans
					.filter((scan) => scan.scanChainInitDate !== null)
					.map((scan) => {
						return [
							getHistoryArchiveUrlIdentity(scan.baseUrl.value) ??
								scan.baseUrl.value,
							scan.scanChainInitDate
						];
					})
			)
		);

		const scanJobs: ScanJob[] = [...errorRecheckJobs];
		//we want to start at least one scan from the very beginning
		let hasAtLeastOneInitScan = false;
		archivesSortedByInitDate.forEach((archive) => {
			if (!hasAtLeastOneInitScan) {
				hasAtLeastOneInitScan = true;
				scanJobs.push(new ScanJob(archive));
				return;
			}

			const previousScan = previousScansMap.get(
				getHistoryArchiveUrlIdentity(archive) ?? archive
			);
			if (!previousScan) {
				scanJobs.push(new ScanJob(archive));
			} else {
				scanJobs.push(
					new ScanJob(
						archive,
						previousScan.latestScannedLedger,
						previousScan.latestScannedLedgerHeaderHash,
						previousScan.scanChainInitDate
					)
				);
			}
		});

		return scanJobs;
	}

	private createErrorRecheckJob(previousScan: Scan): ScanJob {
		const fromLedger =
			previousScan.latestScannedLedger > 0
				? previousScan.latestScannedLedger + 1
				: previousScan.fromLedger;
		const toLedger = this.getErrorRecheckToLedger(previousScan, fromLedger);
		const concurrency =
			previousScan.concurrency > 0
				? this.clampConcurrency(previousScan.concurrency)
				: null;

		return new ScanJob(
			previousScan.baseUrl.value,
			previousScan.latestScannedLedger,
			previousScan.latestScannedLedgerHeaderHash,
			previousScan.scanChainInitDate,
			fromLedger,
			toLedger,
			concurrency
		);
	}

	private getErrorRecheckToLedger(
		previousScan: Scan,
		fromLedger: number
	): number | null {
		const archiveVerificationErrors = previousScan.scanErrors.filter(
			(error) => error.type === ScanErrorType.TYPE_VERIFICATION
		);
		if (archiveVerificationErrors.length === 0) return previousScan.toLedger;

		const errorLedgers = archiveVerificationErrors.map((error) =>
			extractLedgerFromHistoryArchiveUrl(error.url)
		);
		if (errorLedgers.some((ledger) => ledger === null))
			return previousScan.toLedger;

		const latestErrorLedger = Math.max(
			...errorLedgers.filter((ledger): ledger is number => ledger !== null)
		);
		return latestErrorLedger >= fromLedger
			? latestErrorLedger
			: previousScan.toLedger;
	}

	private clampConcurrency(concurrency: number): number {
		return Math.min(Math.max(concurrency, 1), this.maxConcurrency);
	}

	private isArchiveErrorRecheckDue(scan: Scan): boolean {
		const ageMs = this.now().getTime() - scan.endDate.getTime();
		return ageMs >= this.archiveErrorRecheckIntervalMs;
	}
}
