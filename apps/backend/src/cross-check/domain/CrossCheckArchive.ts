import type { CrossCheckProbeMode } from './CrossCheckSource.js';

export type CrossCheckArchiveComparisonStatus = 'not_compared';

export type CrossCheckArchiveEvidenceSelection =
	'latest_verification_scan_preferred';

export type CrossCheckArchiveEvidenceStatus =
	'archive_verification_error' | 'no_archive_error_observed';

export type CrossCheckWorkerEvidenceStatus =
	'no_worker_issue_observed' | 'worker_issue';

export interface CrossCheckArchiveIssueDTO {
	readonly message: string;
	readonly url: string;
}

export interface CrossCheckRadarComparisonDTO {
	readonly comparisonStatus: CrossCheckArchiveComparisonStatus;
	readonly probe: CrossCheckProbeMode;
	readonly sourceId: 'withobsrvr-radar';
}

export interface CrossCheckArchiveEvidenceDTO {
	readonly archiveEvidenceStatus: CrossCheckArchiveEvidenceStatus;
	readonly archiveVerificationErrorCount: number;
	readonly archiveVerificationErrors: readonly CrossCheckArchiveIssueDTO[];
	readonly hasArchiveVerificationError: boolean;
	readonly hasWorkerIssue: boolean;
	readonly isSlowArchive: boolean;
	readonly latestVerifiedLedger: number;
	readonly scanCompletedAt: string;
	readonly scanStartedAt: string;
	readonly workerEvidenceStatus: CrossCheckWorkerEvidenceStatus;
	readonly workerIssueCount: number;
	readonly workerIssues: readonly CrossCheckArchiveIssueDTO[];
}

export interface CrossCheckArchiveDTO {
	readonly archiveUrl: string;
	readonly comparisonStatus: CrossCheckArchiveComparisonStatus;
	readonly radarComparison: CrossCheckRadarComparisonDTO;
	readonly stellarAtlas: CrossCheckArchiveEvidenceDTO;
}

export interface CrossCheckArchivesDTO {
	readonly archives: readonly CrossCheckArchiveDTO[];
	readonly comparisonStatus: CrossCheckArchiveComparisonStatus;
	readonly count: number;
	readonly evidenceSelection: CrossCheckArchiveEvidenceSelection;
	readonly generatedAt: string;
	readonly limit: number;
	readonly probe: CrossCheckProbeMode;
}
