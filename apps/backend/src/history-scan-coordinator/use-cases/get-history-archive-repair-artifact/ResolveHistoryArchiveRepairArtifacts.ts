import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { HistoryArchiveRepairArtifactRepository } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { historyArchiveBucketHashPattern } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import {
	deferredRepairArtifact,
	toRepairArtifactAvailability,
	toPresentRepairArtifact,
	type HistoryArchiveRepairArtifactAvailabilityV1
} from './HistoryArchiveRepairArtifactContract.js';

const maxArtifactProbes = 100;
const probeConcurrency = 8;

export interface ProvenBucketArtifactCandidate {
	readonly bucketHash: string;
	readonly provenAt: Date;
}

@injectable()
export class ResolveHistoryArchiveRepairArtifacts {
	constructor(
		@inject(TYPES.HistoryArchiveRepairArtifactRepository)
		private readonly repository: HistoryArchiveRepairArtifactRepository
	) {}

	async execute(
		candidates: readonly ProvenBucketArtifactCandidate[]
	): Promise<ReadonlyMap<string, HistoryArchiveRepairArtifactAvailabilityV1>> {
		const candidatesByHash = latestCandidatesByHash(candidates);
		const hashes = Array.from(candidatesByHash.keys());
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
						const presence = await this.repository.inspectBucketPresence(hash);
						const candidate = candidatesByHash.get(hash);
						results.set(
							hash,
							presence.status === 'present'
								? candidate === undefined
									? deferredRepairArtifact(hash)
									: toPresentRepairArtifact(presence, candidate.provenAt)
								: toRepairArtifactAvailability(presence)
						);
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

function latestCandidatesByHash(
	candidates: readonly ProvenBucketArtifactCandidate[]
): ReadonlyMap<string, ProvenBucketArtifactCandidate> {
	const byHash = new Map<string, ProvenBucketArtifactCandidate>();
	for (const candidate of candidates) {
		const bucketHash = candidate.bucketHash.trim().toLowerCase();
		if (!historyArchiveBucketHashPattern.test(bucketHash)) continue;
		const current = byHash.get(bucketHash);
		if (current === undefined || current.provenAt < candidate.provenAt) {
			byHash.set(bucketHash, { bucketHash, provenAt: candidate.provenAt });
		}
	}
	return byHash;
}
