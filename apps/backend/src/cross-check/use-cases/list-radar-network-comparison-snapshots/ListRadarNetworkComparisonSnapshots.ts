import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { CROSS_CHECK_TYPES } from '../../domain/CrossCheckTypes.js';
import type {
	CrossCheckRadarNetworkComparisonSnapshotListDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository
} from '../../domain/CrossCheckRadarNetworkSnapshot.js';

export interface ListRadarNetworkComparisonSnapshotsDTO {
	readonly limit?: number;
}

@injectable()
export class ListRadarNetworkComparisonSnapshots {
	private static readonly defaultLimit = 10;
	static readonly maxLimit = 25;

	constructor(
		@inject(CROSS_CHECK_TYPES.RadarNetworkComparisonSnapshotRepository)
		private readonly repository: CrossCheckRadarNetworkComparisonSnapshotRepository
	) {}

	async execute(
		dto: ListRadarNetworkComparisonSnapshotsDTO = {}
	): Promise<Result<CrossCheckRadarNetworkComparisonSnapshotListDTO, Error>> {
		try {
			const limit = this.normalizeLimit(dto.limit);
			const snapshots = await this.repository.findRecent(limit);

			return ok({
				count: snapshots.length,
				generatedAt: new Date().toISOString(),
				limit,
				snapshots
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined)
			return ListRadarNetworkComparisonSnapshots.defaultLimit;

		return Math.min(limit, ListRadarNetworkComparisonSnapshots.maxLimit);
	}
}
