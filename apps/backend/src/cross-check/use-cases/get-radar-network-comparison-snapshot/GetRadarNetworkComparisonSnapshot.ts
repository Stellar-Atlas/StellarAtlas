import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { CROSS_CHECK_TYPES } from '../../domain/CrossCheckTypes.js';
import type {
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository
} from '../../domain/CrossCheckRadarNetworkSnapshot.js';

@injectable()
export class GetRadarNetworkComparisonSnapshot {
	constructor(
		@inject(CROSS_CHECK_TYPES.RadarNetworkComparisonSnapshotRepository)
		private readonly repository: CrossCheckRadarNetworkComparisonSnapshotRepository
	) {}

	async execute(): Promise<
		Result<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null, Error>
	> {
		try {
			return ok(await this.repository.findLatest());
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
