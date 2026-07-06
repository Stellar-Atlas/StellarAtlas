import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveBucketCrossCoverageV1 } from 'shared';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapHistoryArchiveBucketCoverage } from '../../infrastructure/mappers/mapHistoryArchiveBucketCoverage.js';

const bucketHashPattern = /^[0-9a-f]{64}$/i;

export class InvalidBucketHashError extends Error {
	constructor(bucketHash: string) {
		super(`Invalid bucket hash: ${bucketHash}`);
	}
}

@injectable()
export class GetHistoryArchiveBucketCoverage {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		bucketHash: string
	): Promise<Result<HistoryArchiveBucketCrossCoverageV1, Error>> {
		if (!bucketHashPattern.test(bucketHash)) {
			return err(new InvalidBucketHashError(bucketHash));
		}

		const normalizedBucketHash = bucketHash.toLowerCase();
		try {
			const objects =
				await this.objectRepository.findBucketObjectsByHash(
					normalizedBucketHash
				);

			return ok(
				mapHistoryArchiveBucketCoverage(
					normalizedBucketHash,
					objects,
					new Date()
				)
			);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
