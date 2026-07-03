import type {
	CrossCheckApiDocsComparisonDTO,
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

export interface CrossCheckApiDocsComparisonSnapshotRepository {
	findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null>;
	save(
		snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO>;
}
