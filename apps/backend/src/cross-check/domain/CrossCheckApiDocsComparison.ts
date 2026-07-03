import type { RadarApiOperationMethod } from './RadarApiDocs.js';

export type CrossCheckApiDocsSourceId = 'stellaratlas-api' | 'withobsrvr-radar';

export type CrossCheckApiDocsOperationComparisonStatus =
	'field_mismatch' | 'matched' | 'source_missing' | 'stellaratlas_missing';

export type CrossCheckApiDocsOperationField =
	'operationId' | 'schemaRefs' | 'summary' | 'tags';

export type CrossCheckApiDocsFieldValue = readonly string[] | string | null;

export interface CrossCheckApiDocsOperationDTO {
	readonly method: RadarApiOperationMethod;
	readonly operationId: string | null;
	readonly path: string;
	readonly schemaRefs: readonly string[];
	readonly summary: string | null;
	readonly tags: readonly string[];
}

export interface StellarAtlasApiDocsOperationSnapshotDTO {
	readonly documentationUrl: string | null;
	readonly loadedAt: string;
	readonly operations: readonly CrossCheckApiDocsOperationDTO[];
	readonly sourceId: 'stellaratlas-api';
	readonly title: string;
	readonly version: string;
}

export interface CrossCheckApiDocsOperationKeyDTO {
	readonly method: RadarApiOperationMethod;
	readonly path: string;
}

export interface CrossCheckApiDocsFieldMismatchDTO {
	readonly field: CrossCheckApiDocsOperationField;
	readonly sourceValue: CrossCheckApiDocsFieldValue;
	readonly stellarAtlasValue: CrossCheckApiDocsFieldValue;
}

export interface CrossCheckApiDocsOperationComparisonDTO {
	readonly comparisonStatus: CrossCheckApiDocsOperationComparisonStatus;
	readonly fieldMismatches: readonly CrossCheckApiDocsFieldMismatchDTO[];
	readonly key: CrossCheckApiDocsOperationKeyDTO;
	readonly source: CrossCheckApiDocsOperationDTO | null;
	readonly stellarAtlas: CrossCheckApiDocsOperationDTO | null;
}

export interface CrossCheckApiDocsSnapshotMetadataDTO {
	readonly documentationUrl: string | null;
	readonly observedAt: string;
	readonly operationCount: number;
	readonly sourceId: CrossCheckApiDocsSourceId;
	readonly title: string;
	readonly version: string;
}

export interface CrossCheckApiDocsComparisonSummaryDTO {
	readonly fieldMismatchCount: number;
	readonly matchedCount: number;
	readonly sourceMissingCount: number;
	readonly stellarAtlasMissingCount: number;
	readonly totalCount: number;
}

export interface CrossCheckApiDocsComparisonDTO {
	readonly comparisonStatus: 'compared';
	readonly generatedAt: string;
	readonly operations: readonly CrossCheckApiDocsOperationComparisonDTO[];
	readonly source: CrossCheckApiDocsSnapshotMetadataDTO;
	readonly stellarAtlas: CrossCheckApiDocsSnapshotMetadataDTO;
	readonly summary: CrossCheckApiDocsComparisonSummaryDTO;
}
