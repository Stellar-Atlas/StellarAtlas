import type { Result } from 'neverthrow';
import type {
	CrossCheckRadarNetworkComparisonDTO,
	CrossCheckRadarNetworkComparisonSummaryDTO,
	CrossCheckStellarAtlasNetworkRowsDTO
} from './CrossCheckRadarNetworkComparison.js';
import type { RadarNetworkFetchOptions } from './RadarNetworkSnapshot.js';

export type CrossCheckRadarNetworkSourceId =
	'stellaratlas-api' | 'withobsrvr-radar';

export type CrossCheckRadarNetworkSnapshotStatus = 'compared' | 'failed';

export type CrossCheckRadarNetworkSnapshotFailurePhase =
	'comparison' | 'radar_fetch' | 'stellaratlas_read';

export interface CrossCheckRadarNetworkSnapshotFailureDTO {
	readonly kind: string;
	readonly limitBytes?: number;
	readonly message: string;
	readonly occurredAt: string;
	readonly phase: CrossCheckRadarNetworkSnapshotFailurePhase;
	readonly sourceId: CrossCheckRadarNetworkSourceId | null;
	readonly status?: number;
}

export interface SaveCrossCheckRadarNetworkComparisonSnapshotSuccessDTO {
	readonly comparison: CrossCheckRadarNetworkComparisonDTO;
	readonly failure: null;
	readonly generatedAt: string;
	readonly status: 'compared';
}

export interface SaveCrossCheckRadarNetworkComparisonSnapshotFailureDTO {
	readonly comparison: null;
	readonly failure: CrossCheckRadarNetworkSnapshotFailureDTO;
	readonly generatedAt: string;
	readonly status: 'failed';
}

export type SaveCrossCheckRadarNetworkComparisonSnapshotDTO =
	| SaveCrossCheckRadarNetworkComparisonSnapshotFailureDTO
	| SaveCrossCheckRadarNetworkComparisonSnapshotSuccessDTO;

export type CrossCheckRadarNetworkComparisonSnapshotRecordDTO =
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO & {
		readonly id: string;
		readonly storedAt: string;
	};

export interface CrossCheckRadarNetworkComparisonSnapshotListItemDTO {
	readonly comparisonSummary: CrossCheckRadarNetworkComparisonSummaryDTO | null;
	readonly failure: CrossCheckRadarNetworkSnapshotFailureDTO | null;
	readonly generatedAt: string;
	readonly id: string;
	readonly status: CrossCheckRadarNetworkSnapshotStatus;
	readonly storedAt: string;
}

export interface CrossCheckRadarNetworkComparisonSnapshotListDTO {
	readonly count: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly snapshots: readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[];
}

export interface CrossCheckRadarNetworkComparisonSnapshotRepository {
	findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null>;
	findRecent(
		limit: number
	): Promise<readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]>;
	save(
		snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO>;
}

export interface CrossCheckStellarAtlasNetworkRowsSource {
	readRows(): Promise<Result<CrossCheckStellarAtlasNetworkRowsDTO, Error>>;
}

export interface RefreshRadarNetworkComparisonSnapshotDTO {
	readonly radar?: RadarNetworkFetchOptions;
}
