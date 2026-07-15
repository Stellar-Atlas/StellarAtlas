import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { HistoryArchiveRepairArtifactRepository } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { historyArchiveBucketHashPattern } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import {
	toRepairArtifactAvailability,
	type HistoryArchiveRepairArtifactAvailabilityV1
} from './HistoryArchiveRepairArtifactContract.js';

const maxArtifactProbes = 20;
const probeConcurrency = 2;

@injectable()
export class ResolveHistoryArchiveRepairArtifacts {
	constructor(
		@inject(TYPES.HistoryArchiveRepairArtifactRepository)
		private readonly repository: HistoryArchiveRepairArtifactRepository
	) {}

	async execute(
		bucketHashes: readonly string[]
	): Promise<ReadonlyMap<string, HistoryArchiveRepairArtifactAvailabilityV1>> {
		const hashes = Array.from(
			new Set(bucketHashes.map((bucketHash) => bucketHash.trim().toLowerCase()))
		);
		const results = new Map<
			string,
			HistoryArchiveRepairArtifactAvailabilityV1
		>();
		let cursor = 0;

		await Promise.all(
			Array.from(
				{
					length: Math.min(probeConcurrency, hashes.length, maxArtifactProbes)
				},
				async () => {
					while (cursor < Math.min(hashes.length, maxArtifactProbes)) {
						const hash = hashes[cursor];
						cursor++;
						if (hash === undefined) return;
						const inspection = await this.repository.inspectBucket(hash);
						results.set(hash, toRepairArtifactAvailability(inspection));
					}
				}
			)
		);

		for (const hash of hashes.slice(maxArtifactProbes)) {
			results.set(
				hash,
				toRepairArtifactAvailability(
					historyArchiveBucketHashPattern.test(hash)
						? {
								bucketHash: hash,
								reason: 'verification-deferred',
								retryAfterSeconds: 5,
								retryable: true,
								status: 'unavailable'
							}
						: {
								bucketHash: null,
								reason: 'invalid-object-identity',
								retryAfterSeconds: null,
								retryable: false,
								status: 'unavailable'
							}
				)
			);
		}

		return results;
	}
}
