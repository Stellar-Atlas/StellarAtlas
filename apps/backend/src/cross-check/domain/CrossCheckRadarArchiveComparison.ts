import type {
	CrossCheckArchiveDTO,
	CrossCheckArchiveEvidenceDTO,
	CrossCheckArchiveEvidenceSelection
} from './CrossCheckArchive.js';
import type { RadarHistoryArchiveScanDTO } from './RadarHistoryArchiveScan.js';

export type CrossCheckRadarArchiveComparisonStatus =
	| 'field_mismatch'
	| 'matched'
	| 'not_loaded'
	| 'source_missing'
	| 'stellaratlas_missing';

export type CrossCheckRadarArchiveField =
	| 'archiveVerificationErrorMessages'
	| 'archiveVerificationErrorUrls'
	| 'hasArchiveVerificationError'
	| 'isSlowArchive'
	| 'latestVerifiedLedger';

export type CrossCheckRadarArchiveFieldValue =
	readonly string[] | boolean | number | string | null;

export type CrossCheckRadarArchiveSourceLookupStatus =
	'found' | 'not_found' | 'not_loaded';

export interface CrossCheckRadarArchiveFieldMismatchDTO {
	readonly field: CrossCheckRadarArchiveField;
	readonly sourceValue: CrossCheckRadarArchiveFieldValue;
	readonly stellarAtlasValue: CrossCheckRadarArchiveFieldValue;
}

export interface CrossCheckRadarArchiveSourceRowDTO {
	readonly archiveUrl: string;
	readonly scan: RadarHistoryArchiveScanDTO | null;
}

export interface CrossCheckRadarArchiveSourceSnapshotDTO {
	readonly generatedAt: string;
	readonly rows: readonly CrossCheckRadarArchiveSourceRowDTO[];
	readonly sourceId: 'withobsrvr-radar';
}

export interface CrossCheckRadarArchiveRecordComparisonDTO {
	readonly comparisonStatus: CrossCheckRadarArchiveComparisonStatus;
	readonly fieldMismatches: readonly CrossCheckRadarArchiveFieldMismatchDTO[];
	readonly key: string;
	readonly source: RadarHistoryArchiveScanDTO | null;
	readonly sourceLookupStatus: CrossCheckRadarArchiveSourceLookupStatus;
	readonly stellarAtlas: CrossCheckArchiveEvidenceDTO | null;
}

export interface CrossCheckRadarArchiveSourceMetadataDTO {
	readonly archiveCount: number;
	readonly noScanCount: number;
	readonly observedAt: string;
	readonly scanCount: number;
	readonly sourceId: 'withobsrvr-radar';
}

export interface CrossCheckRadarArchiveStellarAtlasMetadataDTO {
	readonly archiveCount: number;
	readonly evidenceSelection: CrossCheckArchiveEvidenceSelection;
	readonly observedAt: string;
	readonly sourceId: 'stellaratlas-api';
}

export interface CrossCheckRadarArchiveComparisonSummaryDTO {
	readonly archiveCount: number;
	readonly fieldMismatchCount: number;
	readonly matchedCount: number;
	readonly notLoadedCount: number;
	readonly sourceMissingCount: number;
	readonly stellarAtlasMissingCount: number;
	readonly totalCount: number;
}

export interface CrossCheckRadarArchiveComparisonDTO {
	readonly archives: readonly CrossCheckRadarArchiveRecordComparisonDTO[];
	readonly comparisonStatus: 'compared';
	readonly generatedAt: string;
	readonly source: CrossCheckRadarArchiveSourceMetadataDTO;
	readonly stellarAtlas: CrossCheckRadarArchiveStellarAtlasMetadataDTO;
	readonly summary: CrossCheckRadarArchiveComparisonSummaryDTO;
	readonly warnings: readonly string[];
}

export interface CrossCheckStellarAtlasArchiveRowsDTO {
	readonly archives: readonly CrossCheckArchiveDTO[];
	readonly count: number;
	readonly evidenceSelection: CrossCheckArchiveEvidenceSelection;
	readonly generatedAt: string;
}
