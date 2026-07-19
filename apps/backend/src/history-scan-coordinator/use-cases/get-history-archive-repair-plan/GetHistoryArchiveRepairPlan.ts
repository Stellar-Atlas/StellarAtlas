import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Url } from '@core/domain/Url.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { HistoryArchiveRepairPlanResponseV1 } from '../get-history-archive-repair-artifact/HistoryArchiveRepairArtifactContract.js';
import { ResolveHistoryArchiveRepairArtifacts } from '../get-history-archive-repair-artifact/ResolveHistoryArchiveRepairArtifacts.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import {
	createRemoteReplacementCandidates,
	isArchiveObjectEvidence,
	isRepairableObjectFailure,
	toCheckpointRepairAction,
	toObjectRepairAction,
	toRepairInfrastructureBlock
} from './HistoryArchiveRepairActionMapper.js';

const defaultRepairLimit = 100;
export const maxRepairPlanLimit = 500;
const sourceCandidateLimit = 5;

@injectable()
export class GetHistoryArchiveRepairPlan {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveCheckpointProofRepository)
		private readonly proofRepository: HistoryArchiveCheckpointProofRepository,
		private readonly repairArtifacts: ResolveHistoryArchiveRepairArtifacts,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(options: {
		readonly limit?: number;
		readonly url: string;
	}): Promise<Result<HistoryArchiveRepairPlanResponseV1, Error>> {
		if (Url.create(options.url).isErr()) {
			return err(new InvalidUrlError(options.url));
		}

		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(options.url);
		if (archiveUrlIdentity === null) {
			return err(new InvalidUrlError(options.url));
		}

		try {
			const limit = normalizeLimit(options.limit);
			const [summary, objectFailures, checkpointFailures] = await Promise.all([
				this.objectRepository.getRepairPlanSummary(archiveUrlIdentity),
				this.objectRepository.findActionableByArchiveUrl(options.url, limit),
				this.proofRepository.findActionableByArchiveUrlIdentity(
					archiveUrlIdentity,
					limit
				)
			]);
			const repairableObjectFailures = objectFailures.filter(
				isRepairableObjectFailure
			);
			const bucketObjectIds = repairableObjectFailures.flatMap((object) =>
				object.bucketHash === null ? [] : [object.remoteId]
			);
			const checkpointObjectIds = repairableObjectFailures.flatMap((object) =>
				object.bucketHash === null ? [object.remoteId] : []
			);
			const [bucketSources, checkpointSources] = await Promise.all([
				bucketObjectIds.length === 0
					? Promise.resolve([])
					: this.objectRepository.findVerifiedBucketSourcesByRemoteIds(
							bucketObjectIds,
							sourceCandidateLimit
						),
				checkpointObjectIds.length === 0
					? Promise.resolve([])
					: this.objectRepository.findVerifiedCheckpointObjectSources(
							checkpointObjectIds,
							sourceCandidateLimit
						)
			]);
			const repairArtifacts = await this.repairArtifacts.execute(
				createBucketArtifactProofs(bucketObjectIds, bucketSources)
			);
			const remoteCandidates = createRemoteReplacementCandidates(
				repairableObjectFailures,
				bucketSources,
				checkpointSources
			);
			const actions = [
				...repairableObjectFailures.flatMap((object) =>
					toObjectRepairAction(
						object,
						remoteCandidates.get(object.remoteId) ?? [],
						repairArtifacts
					)
				),
				...checkpointFailures.flatMap(toCheckpointRepairAction)
			].slice(0, limit);

			return ok({
				actionCount: actions.length,
				actions,
				archiveUrl: options.url,
				archiveUrlIdentity,
				generatedAt: new Date().toISOString(),
				infrastructureBlocks: [
					...summary.hostThrottles
						.filter((throttle) => throttle.evidenceClass !== 'archive-object')
						.map((throttle) => ({
							archiveUrlIdentity: throttle.archiveUrlIdentity,
							blockedUntil: throttle.blockedUntil,
							evidenceClass: throttle.evidenceClass,
							failureClass: throttle.failureClass,
							hostIdentity: throttle.hostIdentity,
							httpStatus: throttle.httpStatus,
							summary: 'Scanner infrastructure is backing off this host.'
						})),
					...objectFailures
						.filter((object) => !isArchiveObjectEvidence(object))
						.map(toRepairInfrastructureBlock)
				],
				limit,
				summary: {
					activeObjectChecks: summary.activeObjects,
					failedCheckpointProofs: summary.failedCheckpointProofs,
					failedObjectChecks: summary.failedObjects,
					pendingObjectChecks: summary.pendingObjects,
					verifiedObjectChecks: summary.verifiedObjects
				}
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function createBucketArtifactProofs(
	targetRemoteIds: readonly string[],
	sources: Awaited<
		ReturnType<
			HistoryArchiveObjectRepository['findVerifiedBucketSourcesByRemoteIds']
		>
	>
): readonly { readonly bucketHash: string; readonly provenAt: Date }[] {
	const requestedIds = new Set(targetRemoteIds);
	const proofByHash = new Map<string, Date>();
	for (const source of sources) {
		if (!requestedIds.has(source.targetRemoteId)) continue;
		const previous = proofByHash.get(source.bucketHash);
		if (previous === undefined || previous < source.proofEvaluatedAt) {
			proofByHash.set(source.bucketHash, source.proofEvaluatedAt);
		}
	}
	return Array.from(proofByHash, ([bucketHash, provenAt]) => ({
		bucketHash,
		provenAt
	}));
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) {
		return defaultRepairLimit;
	}
	return Math.min(limit, maxRepairPlanLimit);
}
