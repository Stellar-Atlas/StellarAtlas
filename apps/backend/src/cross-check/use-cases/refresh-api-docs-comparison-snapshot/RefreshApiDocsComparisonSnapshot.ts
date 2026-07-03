import 'reflect-metadata';
import { injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	CrossCheckApiDocsSnapshotFailureDTO,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '../../domain/CrossCheckApiDocsSnapshot.js';
import type {
	CrossCheckRadarApiDocsSource,
	CrossCheckStellarAtlasApiDocsReadOptions,
	CrossCheckStellarAtlasApiDocsSource,
	RadarApiDocsFetchOptions,
	StellarAtlasApiDocsFailureDTO
} from '../../domain/CrossCheckApiDocsSources.js';
import type { RadarApiDocsFailureDTO } from '../../domain/RadarApiDocs.js';
import type { CrossCheckApiDocsComparisonDTO } from '../../domain/CrossCheckApiDocsComparison.js';
import type { CompareRadarApiDocsOperationsDTO } from '../compare-radar-api-docs/CompareRadarApiDocsOperations.js';

export interface RefreshApiDocsComparisonSnapshotDTO {
	readonly radar?: RadarApiDocsFetchOptions;
	readonly stellarAtlas?: CrossCheckStellarAtlasApiDocsReadOptions;
}

export interface CrossCheckApiDocsComparer {
	execute(
		dto: CompareRadarApiDocsOperationsDTO
	): Result<CrossCheckApiDocsComparisonDTO, Error>;
}

@injectable()
export class RefreshApiDocsComparisonSnapshot {
	constructor(
		private readonly radarSource: CrossCheckRadarApiDocsSource,
		private readonly stellarAtlasSource: CrossCheckStellarAtlasApiDocsSource,
		private readonly repository: CrossCheckApiDocsComparisonSnapshotRepository,
		private readonly comparer: CrossCheckApiDocsComparer,
		private readonly now: () => Date = () => new Date()
	) {}

	async execute(
		dto: RefreshApiDocsComparisonSnapshotDTO = {}
	): Promise<Result<CrossCheckApiDocsComparisonSnapshotRecordDTO, Error>> {
		const radarSnapshotOrError = await this.radarSource.fetchDocs(dto.radar);
		if (radarSnapshotOrError.isErr()) {
			return this.saveFailure(
				mapRadarFailure(radarSnapshotOrError.error, this.now())
			);
		}

		const stellarAtlasSnapshotOrError = this.stellarAtlasSource.readDocs(
			dto.stellarAtlas
		);
		if (stellarAtlasSnapshotOrError.isErr()) {
			return this.saveFailure(
				mapStellarAtlasFailure(stellarAtlasSnapshotOrError.error, this.now())
			);
		}

		const comparisonOrError = this.comparer.execute({
			radar: radarSnapshotOrError.value,
			stellarAtlas: stellarAtlasSnapshotOrError.value
		});
		if (comparisonOrError.isErr()) {
			return this.saveFailure(
				createComparisonFailure(comparisonOrError.error, this.now())
			);
		}

		return this.saveSnapshot({
			comparison: comparisonOrError.value,
			failure: null,
			generatedAt: comparisonOrError.value.generatedAt,
			status: 'compared'
		});
	}

	private async saveFailure(
		failure: CrossCheckApiDocsSnapshotFailureDTO
	): Promise<Result<CrossCheckApiDocsComparisonSnapshotRecordDTO, Error>> {
		return this.saveSnapshot({
			comparison: null,
			failure,
			generatedAt: failure.occurredAt,
			status: 'failed'
		});
	}

	private async saveSnapshot(
		snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<Result<CrossCheckApiDocsComparisonSnapshotRecordDTO, Error>> {
		try {
			return ok(await this.repository.save(snapshot));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

function mapRadarFailure(
	failure: RadarApiDocsFailureDTO,
	occurredAt: Date
): CrossCheckApiDocsSnapshotFailureDTO {
	return {
		...optionalFailureDetails(failure),
		kind: failure.kind,
		message: failure.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'radar_fetch',
		sourceId: 'withobsrvr-radar'
	};
}

function mapStellarAtlasFailure(
	failure: StellarAtlasApiDocsFailureDTO,
	occurredAt: Date
): CrossCheckApiDocsSnapshotFailureDTO {
	return {
		kind: failure.kind,
		message: failure.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'stellaratlas_read',
		sourceId: 'stellaratlas-api'
	};
}

function createComparisonFailure(
	error: Error,
	occurredAt: Date
): CrossCheckApiDocsSnapshotFailureDTO {
	return {
		kind: 'comparison_error',
		message: error.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'comparison',
		sourceId: null
	};
}

function optionalFailureDetails(
	failure: RadarApiDocsFailureDTO
): Pick<CrossCheckApiDocsSnapshotFailureDTO, 'limitBytes' | 'status'> {
	return {
		...(failure.limitBytes !== undefined
			? { limitBytes: failure.limitBytes }
			: {}),
		...(failure.status !== undefined ? { status: failure.status } : {})
	};
}
