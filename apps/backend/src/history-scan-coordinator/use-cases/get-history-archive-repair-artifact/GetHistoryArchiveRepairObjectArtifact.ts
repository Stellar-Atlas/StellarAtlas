import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type {
	HistoryArchiveRepairObjectArtifactRepository,
	HistoryArchiveRepairObjectArtifactUnavailableReason,
	OpenHistoryArchiveRepairObjectArtifact
} from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { isRepairableObjectFailure } from '../get-history-archive-repair-plan/HistoryArchiveRepairActionMapper.js';

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;
const sourceLimit = 5;

export type HistoryArchiveRepairObjectDownloadUnavailableReason =
	HistoryArchiveRepairObjectArtifactUnavailableReason | 'proof-no-longer-valid';

export type GetHistoryArchiveRepairObjectArtifactResult =
	| OpenHistoryArchiveRepairObjectArtifact
	| {
			readonly reason: HistoryArchiveRepairObjectDownloadUnavailableReason;
			readonly retryAfterSeconds: number | null;
			readonly retryable: boolean;
			readonly status: 'unavailable';
	  };

export interface GetHistoryArchiveRepairObjectArtifactInput {
	readonly candidateRemoteId: string;
	readonly contentDigest: string;
	readonly proofId: string;
	readonly proofEvaluatedAtMs: number;
	readonly proofVersion: number;
	readonly targetRemoteId: string;
}

@injectable()
export class GetHistoryArchiveRepairObjectArtifact {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveRepairObjectArtifactRepository)
		private readonly artifactRepository: HistoryArchiveRepairObjectArtifactRepository
	) {}

	async execute(
		input: GetHistoryArchiveRepairObjectArtifactInput
	): Promise<GetHistoryArchiveRepairObjectArtifactResult> {
		const normalized = normalizeInput(input);
		if (normalized === null) return staleProof();

		const target = await this.objectRepository.findByRemoteId(
			normalized.targetRemoteId
		);
		if (
			target === null ||
			target.status !== 'failed' ||
			!isRepairableObjectFailure(target)
		) {
			return staleProof();
		}

		const sources =
			target.bucketHash === null
				? await this.objectRepository.findVerifiedCheckpointObjectSources(
						[target.remoteId],
						sourceLimit
					)
				: await this.objectRepository.findVerifiedBucketSourcesByRemoteIds(
						[target.remoteId],
						sourceLimit
					);
		const source = sources.find(
			(candidate) =>
				candidate.targetRemoteId === target.remoteId &&
				candidate.candidateRemoteId === normalized.candidateRemoteId &&
				candidate.proofId.toString() === normalized.proofId &&
				candidate.proofVersion === normalized.proofVersion &&
				candidate.proofEvaluatedAt.getTime() ===
					normalized.proofEvaluatedAtMs &&
				candidate.contentDigest === normalized.contentDigest
		);
		if (source === undefined) return staleProof();

		return await this.artifactRepository.openVerifiedObject({
			archiveUrl: source.archiveUrl,
			archiveUrlIdentity: source.archiveUrlIdentity,
			contentDigest: source.contentDigest,
			contentRepresentation: source.contentRepresentation,
			objectIdentity: target.objectKey,
			objectUrl: source.objectUrl
		});
	}
}

function normalizeInput(
	input: GetHistoryArchiveRepairObjectArtifactInput
): GetHistoryArchiveRepairObjectArtifactInput | null {
	const contentDigest = input.contentDigest.trim().toLowerCase();
	if (
		!uuidPattern.test(input.targetRemoteId) ||
		!uuidPattern.test(input.candidateRemoteId) ||
		!/^\d+$/.test(input.proofId) ||
		!Number.isSafeInteger(input.proofEvaluatedAtMs) ||
		input.proofEvaluatedAtMs < 1 ||
		!Number.isSafeInteger(input.proofVersion) ||
		input.proofVersion < 1 ||
		!digestPattern.test(contentDigest)
	) {
		return null;
	}
	return { ...input, contentDigest };
}

function staleProof(): GetHistoryArchiveRepairObjectArtifactResult {
	return {
		reason: 'proof-no-longer-valid',
		retryAfterSeconds: null,
		retryable: false,
		status: 'unavailable'
	};
}
