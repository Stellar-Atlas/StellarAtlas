import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { CROSS_CHECK_TYPES } from '../../domain/CrossCheckTypes.js';
import type {
	CrossCheckApiDocsComparisonSnapshotListDTO,
	CrossCheckApiDocsComparisonSnapshotRepository
} from '../../domain/CrossCheckApiDocsSnapshot.js';

export interface ListApiDocsComparisonSnapshotsDTO {
	readonly limit?: number;
}

@injectable()
export class ListApiDocsComparisonSnapshots {
	private static readonly defaultLimit = 10;
	static readonly maxLimit = 25;

	constructor(
		@inject(CROSS_CHECK_TYPES.ApiDocsComparisonSnapshotRepository)
		private readonly repository: CrossCheckApiDocsComparisonSnapshotRepository
	) {}

	async execute(
		dto: ListApiDocsComparisonSnapshotsDTO = {}
	): Promise<Result<CrossCheckApiDocsComparisonSnapshotListDTO, Error>> {
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
		if (limit === undefined) return ListApiDocsComparisonSnapshots.defaultLimit;

		return Math.min(limit, ListApiDocsComparisonSnapshots.maxLimit);
	}
}
