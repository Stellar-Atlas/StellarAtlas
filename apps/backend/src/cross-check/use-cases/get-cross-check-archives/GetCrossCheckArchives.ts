import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveScan } from 'shared';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import type {
	CrossCheckArchiveDTO,
	CrossCheckArchiveIssueDTO,
	CrossCheckArchivesDTO
} from '../../domain/CrossCheckArchive.js';

export interface GetCrossCheckArchivesDTO {
	readonly limit?: number;
}

@injectable()
export class GetCrossCheckArchives {
	static readonly maxLimit = GetArchiveScans.maxLimit;

	constructor(
		@inject(GetArchiveScans) private readonly getArchiveScans: GetArchiveScans
	) {}

	async execute(
		dto: GetCrossCheckArchivesDTO = {}
	): Promise<Result<CrossCheckArchivesDTO, Error>> {
		const archiveScansOrError = await this.getArchiveScans.execute({
			limit: dto.limit
		});
		if (archiveScansOrError.isErr()) return err(archiveScansOrError.error);

		const archiveScans = archiveScansOrError.value;
		return ok({
			generatedAt: new Date().toISOString(),
			limit: archiveScans.limit,
			count: archiveScans.count,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection: 'latest_verification_scan_preferred',
			archives: archiveScans.scans.map(mapArchiveScan)
		});
	}
}

function mapArchiveScan(scan: HistoryArchiveScan): CrossCheckArchiveDTO {
	const archiveVerificationErrors = getErrorsByType(scan, 'TYPE_VERIFICATION');
	const workerIssues = getErrorsByType(scan, 'TYPE_CONNECTION');

	return {
		archiveUrl: scan.url,
		comparisonStatus: 'not_compared',
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas: {
			archiveEvidenceStatus:
				archiveVerificationErrors.length > 0
					? 'archive_verification_error'
					: 'no_archive_error_observed',
			archiveVerificationErrorCount: archiveVerificationErrors.length,
			archiveVerificationErrors,
			hasArchiveVerificationError: archiveVerificationErrors.length > 0,
			hasWorkerIssue: workerIssues.length > 0,
			isSlowArchive: scan.isSlow,
			latestVerifiedLedger: scan.latestVerifiedLedger,
			scanCompletedAt: scan.endDate.toISOString(),
			scanStartedAt: scan.startDate.toISOString(),
			workerEvidenceStatus:
				workerIssues.length > 0 ? 'worker_issue' : 'no_worker_issue_observed',
			workerIssueCount: workerIssues.length,
			workerIssues
		}
	};
}

function getErrorsByType(
	scan: HistoryArchiveScan,
	type: string
): CrossCheckArchiveIssueDTO[] {
	return scan.errors
		.filter((error) => error.type === type)
		.map((error) => ({
			message: error.message,
			url: error.url
		}));
}
