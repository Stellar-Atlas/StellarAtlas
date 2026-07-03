import 'reflect-metadata';
import { injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	CrossCheckRadarNetworkSnapshotFailureDTO,
	CrossCheckStellarAtlasNetworkRowsSource,
	RefreshRadarNetworkComparisonSnapshotDTO,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '../../domain/CrossCheckRadarNetworkSnapshot.js';
import type { CrossCheckRadarNetworkComparisonDTO } from '../../domain/CrossCheckRadarNetworkComparison.js';
import type {
	CrossCheckRadarNetworkSnapshotSource,
	RadarNetworkSnapshotFailureDTO
} from '../../domain/RadarNetworkSnapshot.js';
import type { CompareRadarNetworkSnapshotDTO } from '../compare-radar-network-snapshot/CompareRadarNetworkSnapshot.js';

export interface CrossCheckRadarNetworkComparer {
	execute(
		dto: CompareRadarNetworkSnapshotDTO
	): Result<CrossCheckRadarNetworkComparisonDTO, Error>;
}

@injectable()
export class RefreshRadarNetworkComparisonSnapshot {
	constructor(
		private readonly radarSource: CrossCheckRadarNetworkSnapshotSource,
		private readonly stellarAtlasSource: CrossCheckStellarAtlasNetworkRowsSource,
		private readonly repository: CrossCheckRadarNetworkComparisonSnapshotRepository,
		private readonly comparer: CrossCheckRadarNetworkComparer,
		private readonly now: () => Date = () => new Date()
	) {}

	async execute(
		dto: RefreshRadarNetworkComparisonSnapshotDTO = {}
	): Promise<Result<CrossCheckRadarNetworkComparisonSnapshotRecordDTO, Error>> {
		const radarSnapshotOrError = await this.radarSource.fetchNetworkSnapshot(
			dto.radar
		);
		if (radarSnapshotOrError.isErr()) {
			return this.saveFailure(
				mapRadarFailure(radarSnapshotOrError.error, this.now())
			);
		}

		const stellarAtlasRowsOrError = await this.stellarAtlasSource.readRows();
		if (stellarAtlasRowsOrError.isErr()) {
			return this.saveFailure(
				createStellarAtlasFailure(stellarAtlasRowsOrError.error, this.now())
			);
		}

		const comparisonOrError = this.comparer.execute({
			radar: radarSnapshotOrError.value,
			stellarAtlas: stellarAtlasRowsOrError.value
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
		failure: CrossCheckRadarNetworkSnapshotFailureDTO
	): Promise<Result<CrossCheckRadarNetworkComparisonSnapshotRecordDTO, Error>> {
		return this.saveSnapshot({
			comparison: null,
			failure,
			generatedAt: failure.occurredAt,
			status: 'failed'
		});
	}

	private async saveSnapshot(
		snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<Result<CrossCheckRadarNetworkComparisonSnapshotRecordDTO, Error>> {
		try {
			return ok(await this.repository.save(snapshot));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

function mapRadarFailure(
	failure: RadarNetworkSnapshotFailureDTO,
	occurredAt: Date
): CrossCheckRadarNetworkSnapshotFailureDTO {
	return {
		...optionalFailureDetails(failure),
		kind: failure.kind,
		message: failure.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'radar_fetch',
		sourceId: 'withobsrvr-radar'
	};
}

function createStellarAtlasFailure(
	error: Error,
	occurredAt: Date
): CrossCheckRadarNetworkSnapshotFailureDTO {
	return {
		kind: 'stellaratlas_read_error',
		message: error.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'stellaratlas_read',
		sourceId: 'stellaratlas-api'
	};
}

function createComparisonFailure(
	error: Error,
	occurredAt: Date
): CrossCheckRadarNetworkSnapshotFailureDTO {
	return {
		kind: 'comparison_error',
		message: error.message,
		occurredAt: occurredAt.toISOString(),
		phase: 'comparison',
		sourceId: null
	};
}

function optionalFailureDetails(
	failure: RadarNetworkSnapshotFailureDTO
): Pick<CrossCheckRadarNetworkSnapshotFailureDTO, 'limitBytes' | 'status'> {
	return {
		...(failure.limitBytes !== undefined
			? { limitBytes: failure.limitBytes }
			: {}),
		...(failure.status !== undefined ? { status: failure.status } : {})
	};
}
