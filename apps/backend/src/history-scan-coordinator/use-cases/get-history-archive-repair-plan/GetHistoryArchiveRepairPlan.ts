import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Url } from '@core/domain/Url.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import type { HistoryArchiveCheckpointProof } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass
} from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import type {
	HistoryArchiveCheckpointRepairEvidenceV1,
	HistoryArchiveRepairActionKindV1,
	HistoryArchiveRepairActionV1,
	HistoryArchiveRepairInfrastructureBlockV1,
	HistoryArchiveRepairObjectEvidenceV1,
	HistoryArchiveRepairPlanV1,
	HistoryArchiveRepairReasonV1,
	HistoryArchiveRepairSourceCandidateV1
} from 'shared';

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
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(options: {
		readonly limit?: number;
		readonly url: string;
	}): Promise<Result<HistoryArchiveRepairPlanV1, Error>> {
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
				this.objectRepository.getSummary({
					archiveUrl: options.url,
					archiveUrlIdentity
				}),
				this.objectRepository.findActionableByArchiveUrl(options.url, limit),
				this.proofRepository.findActionableByArchiveUrlIdentity(
					archiveUrlIdentity,
					limit
				)
			]);
			const repairableObjectFailures = objectFailures.filter(
				isRepairableObjectFailure
			);
			const candidateSources = await this.getBucketSourceCandidates(
				repairableObjectFailures
			);
			const actions = [
				...repairableObjectFailures.flatMap((object) =>
					toObjectAction(object, candidateSources)
				),
				...checkpointFailures.flatMap(toCheckpointAction)
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
						.filter(
							(object) => getObjectEvidenceClass(object) !== 'archive-object'
						)
						.map(toInfrastructureBlock)
				],
				limit,
				summary: {
					activeObjectChecks: summary.activeObjects,
					failedCheckpointProofs:
						summary.checkpoints.categoryConsistencyFailedCheckpoints,
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

	private async getBucketSourceCandidates(
		objects: readonly HistoryArchiveObject[]
	): Promise<
		ReadonlyMap<string, readonly HistoryArchiveRepairSourceCandidateV1[]>
	> {
		const bucketHashes = Array.from(
			new Set(objects.flatMap((object) => object.bucketHash ?? []))
		).slice(0, maxRepairPlanLimit);
		const entries = await Promise.all(
			bucketHashes.map(async (bucketHash) => {
				const bucketObjects =
					await this.objectRepository.findBucketObjectsByHash(bucketHash);
				return [
					bucketHash,
					bucketObjects
						.filter((object) => object.status === 'verified')
						.slice(0, sourceCandidateLimit)
						.map(toSourceCandidate)
				] as const;
			})
		);

		return new Map(entries);
	}
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) {
		return defaultRepairLimit;
	}

	return Math.min(limit, maxRepairPlanLimit);
}

function toObjectAction(
	object: HistoryArchiveObject,
	candidateSources: ReadonlyMap<
		string,
		readonly HistoryArchiveRepairSourceCandidateV1[]
	>
): readonly HistoryArchiveRepairActionV1[] {
	const evidenceClass = getObjectEvidenceClass(object);
	if (evidenceClass !== 'archive-object') return [];

	const bucketSources =
		object.bucketHash === null
			? []
			: (candidateSources.get(object.bucketHash) ?? []);
	const reason = getObjectRepairReason(object);
	const kind = getObjectActionKind(object);

	return [
		{
			actionId: `${kind}:${object.remoteId}`,
			bucketHash: object.bucketHash,
			checkpointEvidence: [],
			checkpointLedger: object.checkpointLedger,
			evidence: [toObjectEvidence(object)],
			kind,
			knownGoodSources: bucketSources,
			reason,
			severity: 'error',
			summary: getObjectActionSummary(object, kind)
		}
	];
}

function isRepairableObjectFailure(object: HistoryArchiveObject): boolean {
	const failureClass = getObjectFailureClass(object);
	if (failureClass === 'not-found') return true;
	if (
		failureClass === 'auth' ||
		failureClass === 'http' ||
		failureClass === 'rate-limit' ||
		failureClass === 'timeout' ||
		failureClass === 'transport' ||
		failureClass === 'worker' ||
		failureClass === 'coordinator'
	) {
		return false;
	}

	const errorType = (object.errorType ?? '').trim().toLowerCase();
	const errorMessage = (object.errorMessage ?? '').trim().toLowerCase();
	if (errorMessage.includes('abort')) return false;
	return (
		errorType.includes('hash') ||
		errorType.includes('mismatch') ||
		errorType === 'bucket_verification_failed' ||
		errorType === 'category_content_invalid' ||
		errorType === 'invalid_checkpoint_state' ||
		errorType === 'invalid_history_archive_state'
	);
}

function toCheckpointAction(
	proof: HistoryArchiveCheckpointProof
): readonly HistoryArchiveRepairActionV1[] {
	if (proof.status !== 'mismatch') return [];

	const reason = getCheckpointRepairReason(proof.failureKind);
	if (reason === 'object-incomplete' || reason === 'proof-facts-incomplete') {
		return [];
	}

	return [
		{
			actionId: `repair-checkpoint-proof:${proof.archiveUrlIdentity}:${proof.checkpointLedger}`,
			bucketHash: null,
			checkpointEvidence: [toCheckpointEvidence(proof)],
			checkpointLedger: proof.checkpointLedger,
			evidence: [],
			kind: 'repair-checkpoint-proof',
			knownGoodSources: [],
			reason,
			severity: 'error',
			summary: getCheckpointActionSummary(proof.checkpointLedger, reason)
		}
	];
}

function getCheckpointActionSummary(
	checkpointLedger: number,
	reason: HistoryArchiveRepairReasonV1
): string {
	if (reason === 'checkpoint-ledger-mismatch') {
		return `Checkpoint state file does not declare checkpoint ${checkpointLedger}.`;
	}
	return `Checkpoint ${checkpointLedger} has a hash mismatch across archive files.`;
}

function getObjectActionKind(
	object: HistoryArchiveObject
): HistoryArchiveRepairActionKindV1 {
	if (object.objectType === 'history-archive-state') {
		return 'restore-history-archive-state';
	}
	if (object.objectType === 'bucket') return 'replace-bucket-file';

	return 'replace-archive-file';
}

function getObjectRepairReason(
	object: HistoryArchiveObject
): HistoryArchiveRepairReasonV1 {
	if (object.errorType === 'checkpoint_state_ledger_mismatch') {
		return 'checkpoint-ledger-mismatch';
	}
	const failureClass = getObjectFailureClass(object);
	if (
		object.objectType === 'history-archive-state' &&
		failureClass === 'not-found'
	) {
		return 'history-archive-state-missing';
	}
	if (failureClass === 'auth') return 'access-denied';
	if (failureClass === 'not-found') return 'missing-object';
	if (failureClass === 'rate-limit') return 'rate-limited';
	if (failureClass === 'transport') return 'transport-error';
	if (failureClass === 'http') return 'http-error';
	if (failureClass === 'worker' || failureClass === 'coordinator') {
		return 'scanner-infrastructure';
	}
	if (object.objectType === 'bucket') return 'bucket-hash-mismatch';

	return 'archive-object-failed';
}

function getCheckpointRepairReason(
	failureKind: string | null
): HistoryArchiveRepairReasonV1 {
	if (failureKind === 'checkpoint-ledger-mismatch') {
		return 'checkpoint-ledger-mismatch';
	}
	if (failureKind === 'checkpoint-bucket-list-mismatch') {
		return 'checkpoint-bucket-list-mismatch';
	}
	if (failureKind === 'transaction-hash-mismatch') {
		return 'transaction-hash-mismatch';
	}
	if (failureKind === 'result-hash-mismatch') return 'result-hash-mismatch';
	if (failureKind === 'previous-ledger-hash-mismatch') {
		return 'previous-ledger-hash-mismatch';
	}
	if (failureKind === 'bucket-missing') return 'bucket-missing';
	if (failureKind === 'object-incomplete') return 'object-incomplete';
	if (failureKind === 'proof-facts-incomplete') {
		return 'proof-facts-incomplete';
	}
	if (failureKind === 'object-failed') return 'object-failed';

	return 'archive-object-failed';
}

function getObjectActionSummary(
	object: HistoryArchiveObject,
	kind: HistoryArchiveRepairActionKindV1
): string {
	if (object.errorType === 'checkpoint_state_ledger_mismatch') {
		return `Checkpoint state file does not declare checkpoint ${object.checkpointLedger ?? 'unknown'}.`;
	}
	if (kind === 'restore-history-archive-state') {
		return 'Restore or republish the archive root history archive state file.';
	}
	if (kind === 'replace-bucket-file') {
		return 'Replace the bucket file with bytes that match the expected bucket hash.';
	}

	return `Replace the ${getObjectTypeLabel(object.objectType)} for checkpoint ${object.checkpointLedger ?? 'unknown'}.`;
}

function toObjectEvidence(
	object: HistoryArchiveObject
): HistoryArchiveRepairObjectEvidenceV1 {
	return {
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		bucketHash: object.bucketHash,
		checkpointLedger: object.checkpointLedger,
		evidenceClass: getObjectEvidenceClass(object),
		errorMessage: object.errorMessage,
		errorType: object.errorType,
		failureClass: getObjectFailureClass(object),
		httpStatus: object.httpStatus,
		nextAttemptAt: object.nextAttemptAt?.toISOString() ?? null,
		objectKey: object.objectKey,
		objectType: object.objectType,
		objectUrl: object.objectUrl,
		observedCheckpointLedger:
			object.verificationFacts?.checkpointHistoryArchiveStateFact
				?.checkpointLedger ?? null,
		remoteId: object.remoteId,
		status: object.status,
		updatedAt: requireDate(object.updatedAt).toISOString()
	};
}

function toCheckpointEvidence(
	proof: HistoryArchiveCheckpointProof
): HistoryArchiveCheckpointRepairEvidenceV1 {
	return {
		bucketsVerified: proof.bucketsVerified,
		checkpointBucketListHash: proof.checkpointBucketListHash,
		checkpointBucketListMatches: proof.checkpointBucketListMatches,
		checkpointLedger: proof.checkpointLedger,
		expectedBucketCount: proof.expectedBucketCount,
		failedBucketCount: proof.failedBucketCount,
		failureKind: proof.failureKind,
		ledgerBucketListHash: proof.ledgerBucketListHash,
		missingBucketCount: proof.missingBucketCount,
		previousLedgersMatch: proof.previousLedgersMatch,
		proofFactsComplete: proof.proofFactsComplete,
		requiredObjectsComplete: proof.requiredObjectsComplete,
		resultsMatch: proof.resultsMatch,
		status: proof.status,
		transactionFactCount: proof.transactionFactCount,
		transactionsMatch: proof.transactionsMatch,
		verifiedBucketCount: proof.verifiedBucketCount
	};
}

function toSourceCandidate(
	object: HistoryArchiveObject
): HistoryArchiveRepairSourceCandidateV1 {
	return {
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		objectUrl: object.objectUrl,
		verifiedAt: object.verifiedAt?.toISOString() ?? null
	};
}

function toInfrastructureBlock(
	object: HistoryArchiveObject
): HistoryArchiveRepairInfrastructureBlockV1 {
	return {
		archiveUrlIdentity: object.archiveUrlIdentity,
		blockedUntil: object.nextAttemptAt?.toISOString() ?? null,
		evidenceClass: getObjectEvidenceClass(object),
		failureClass: getObjectFailureClass(object),
		hostIdentity: object.hostIdentity,
		httpStatus: object.httpStatus,
		summary:
			'Scanner infrastructure must clear before this object can be evaluated.'
	};
}

function getObjectFailureClass(object: HistoryArchiveObject) {
	return classifyHistoryArchiveObjectFailure({
		errorType: object.errorType,
		httpStatus: object.httpStatus
	});
}

function getObjectEvidenceClass(object: HistoryArchiveObject) {
	const failureClass = getObjectFailureClass(object);
	return getHistoryArchiveObjectEvidenceClass(
		failureClass,
		object.failureChannel ??
			(failureClass === 'worker' || failureClass === 'coordinator'
				? 'scanner_issue'
				: 'archive_evidence')
	);
}

function getObjectTypeLabel(objectType: HistoryArchiveObject['objectType']) {
	if (objectType === 'checkpoint-state') return 'checkpoint history file';
	if (objectType === 'transactions') return 'transaction archive file';
	if (objectType === 'results') return 'result archive file';
	if (objectType === 'ledger') return 'ledger archive file';
	if (objectType === 'scp') return 'SCP archive file';
	if (objectType === 'bucket') return 'bucket file';

	return 'history archive state file';
}

function requireDate(value: Date | undefined): Date {
	if (value instanceof Date) return value;
	return new Date(0);
}
