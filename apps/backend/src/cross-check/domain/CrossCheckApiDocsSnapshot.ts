import type {
	CrossCheckApiDocsComparisonDTO,
	CrossCheckApiDocsComparisonSummaryDTO,
	CrossCheckApiDocsSourceId
} from './CrossCheckApiDocsComparison.js';

export type CrossCheckApiDocsSnapshotStatus = 'compared' | 'failed';

export type CrossCheckApiDocsSnapshotFailurePhase =
	'comparison' | 'radar_fetch' | 'stellaratlas_read';

export interface CrossCheckApiDocsSnapshotFailureDTO {
	readonly kind: string;
	readonly limitBytes?: number;
	readonly message: string;
	readonly occurredAt: string;
	readonly phase: CrossCheckApiDocsSnapshotFailurePhase;
	readonly sourceId: CrossCheckApiDocsSourceId | null;
	readonly status?: number;
}

export interface SaveCrossCheckApiDocsComparisonSnapshotSuccessDTO {
	readonly comparison: CrossCheckApiDocsComparisonDTO;
	readonly failure: null;
	readonly generatedAt: string;
	readonly status: 'compared';
}

export interface SaveCrossCheckApiDocsComparisonSnapshotFailureDTO {
	readonly comparison: null;
	readonly failure: CrossCheckApiDocsSnapshotFailureDTO;
	readonly generatedAt: string;
	readonly status: 'failed';
}

export type SaveCrossCheckApiDocsComparisonSnapshotDTO =
	| SaveCrossCheckApiDocsComparisonSnapshotFailureDTO
	| SaveCrossCheckApiDocsComparisonSnapshotSuccessDTO;

export type CrossCheckApiDocsComparisonSnapshotRecordDTO =
	SaveCrossCheckApiDocsComparisonSnapshotDTO & {
		readonly id: string;
		readonly storedAt: string;
	};

export interface CrossCheckApiDocsComparisonSnapshotListItemDTO {
	readonly comparisonSummary: CrossCheckApiDocsComparisonSummaryDTO | null;
	readonly failure: CrossCheckApiDocsSnapshotFailureDTO | null;
	readonly generatedAt: string;
	readonly id: string;
	readonly status: CrossCheckApiDocsSnapshotStatus;
	readonly storedAt: string;
}

export interface CrossCheckApiDocsComparisonSnapshotListDTO {
	readonly count: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly snapshots: readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[];
}

export interface CrossCheckApiDocsComparisonSnapshotRepository {
	findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null>;
	findRecent(
		limit: number
	): Promise<readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]>;
	save(
		snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO>;
}
