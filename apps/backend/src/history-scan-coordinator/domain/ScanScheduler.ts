import { sortHistoryUrls } from './sortHistoryUrls.js';
import { Scan } from './scan/Scan.js';
import { ScanJob } from './ScanJob.js';
import { Url } from 'http-helper';
import { extractLedgerFromHistoryArchiveUrl } from './scan/extractLedgerFromHistoryArchiveUrl.js';

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
	schedule(
		archives: string[],
		previousScans: Scan[],
		unfinishedScanJobs: ScanJob[] = [],
		options: ScanSchedulerOptions = { includeRegularJobs: true }
	): ScanJob[] {
		const scanJobs: ScanJob[] = [];

		const validArchiveUrls = this.mapToValidUrls(archives);
		const uniqueArchives = this.removeDuplicates(validArchiveUrls);
		const unfinishedUrls = new Set(unfinishedScanJobs.map((job) => job.url));
		const unfinishedErrorRecheckUrls = new Set(
			unfinishedScanJobs
				.filter((job) => job.fromLedger !== null || job.toLedger !== null)
				.map((job) => job.url)
		);
		const previousScansMap = new Map(
			previousScans.map((scan) => {
				return [scan.baseUrl.value, scan];
			})
		);
		const archivesReadyForErrorRecheck = uniqueArchives.filter(
			(archive) => !unfinishedErrorRecheckUrls.has(archive)
		);
		const archivesReadyForRegularScan = uniqueArchives.filter(
			(archive) => !unfinishedUrls.has(archive)
		);
		const errorRecheckJobs = archivesReadyForErrorRecheck
			.map((archive) => previousScansMap.get(archive))
			.filter((scan): scan is Scan => scan !== undefined && scan.hasError())
			.map((scan) => this.createErrorRecheckJob(scan));

		if (errorRecheckJobs.length > 0) return errorRecheckJobs;
		if (!options.includeRegularJobs) return [];

		const archivesSortedByInitDate = sortHistoryUrls(
			archivesReadyForRegularScan,
			new Map(
				previousScans
					.filter((scan) => scan.scanChainInitDate !== null)
					.map((scan) => {
						return [scan.baseUrl.value, scan.scanChainInitDate];
					})
			)
		);

		//we want to start at least one scan from the very beginning
		let hasAtLeastOneInitScan = false;
		archivesSortedByInitDate.forEach((archive) => {
			if (!hasAtLeastOneInitScan) {
				hasAtLeastOneInitScan = true;
				scanJobs.push(new ScanJob(archive));
				return;
			}

			const previousScan = previousScansMap.get(archive);
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

	private removeDuplicates(urls: string[]): string[] {
		return Array.from(new Set(urls));
	}

	private mapToValidUrls(archives: string[]): string[] {
		return archives
			.map((archive) => Url.create(archive))
			.filter((result) => result.isOk())
			.map((result) => result.value.value);
	}

	private createErrorRecheckJob(previousScan: Scan): ScanJob {
		const fromLedger =
			previousScan.latestScannedLedger > 0
				? previousScan.latestScannedLedger + 1
				: previousScan.fromLedger;
		const errorLedger = previousScan.error
			? extractLedgerFromHistoryArchiveUrl(previousScan.error.url)
			: null;
		const toLedger =
			errorLedger !== null && errorLedger >= fromLedger
				? errorLedger
				: previousScan.toLedger;
		const concurrency =
			previousScan.concurrency > 0 ? previousScan.concurrency : null;

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
}
