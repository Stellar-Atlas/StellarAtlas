import type { Result } from 'neverthrow';
import type { StellarAtlasApiDocsOperationSnapshotDTO } from './CrossCheckApiDocsComparison.js';
import type {
	RadarApiDocsFailureDTO,
	RadarApiDocsSnapshotDTO
} from './RadarApiDocs.js';

export interface RadarApiDocsFetchOptions {
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}

export interface CrossCheckRadarApiDocsSource {
	fetchDocs(
		options?: RadarApiDocsFetchOptions
	): Promise<Result<RadarApiDocsSnapshotDTO, RadarApiDocsFailureDTO>>;
}

export type StellarAtlasApiDocsFailureKind = 'invalid_openapi';

export interface StellarAtlasApiDocsFailureDTO {
	readonly kind: StellarAtlasApiDocsFailureKind;
	readonly message: string;
}

export interface CrossCheckStellarAtlasApiDocsReadOptions {
	readonly documentationUrl?: string | null;
}

export interface CrossCheckStellarAtlasApiDocsSource {
	readDocs(
		options?: CrossCheckStellarAtlasApiDocsReadOptions
	): Result<
		StellarAtlasApiDocsOperationSnapshotDTO,
		StellarAtlasApiDocsFailureDTO
	>;
}
