import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { CROSS_CHECK_TYPES } from '../../domain/CrossCheckTypes.js';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository
} from '../../domain/CrossCheckApiDocsSnapshot.js';

@injectable()
export class GetApiDocsComparisonSnapshot {
	constructor(
		@inject(CROSS_CHECK_TYPES.ApiDocsComparisonSnapshotRepository)
		private readonly repository: CrossCheckApiDocsComparisonSnapshotRepository
	) {}

	async execute(): Promise<
		Result<CrossCheckApiDocsComparisonSnapshotRecordDTO | null, Error>
	> {
		try {
			return ok(await this.repository.findLatest());
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
