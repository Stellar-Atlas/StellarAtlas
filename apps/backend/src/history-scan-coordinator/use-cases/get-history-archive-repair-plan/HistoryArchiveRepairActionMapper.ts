import type { HistoryArchiveCheckpointProof } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass
} from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import type {
	HistoryArchiveVerifiedBucketSource,
	HistoryArchiveVerifiedCheckpointObjectSource
} from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	deferredRepairArtifact,
	toRemoteRepairArtifact,
	type HistoryArchiveRepairArtifactAvailabilityV1
} from '../get-history-archive-repair-artifact/HistoryArchiveRepairArtifactContract.js';
import type {
	HistoryArchiveCheckpointRepairEvidenceV1,
	HistoryArchiveRepairActionKindV1,
	HistoryArchiveRepairActionV1,
	HistoryArchiveRepairInfrastructureBlockV1,
	HistoryArchiveRepairObjectEvidenceV1,
	HistoryArchiveRepairReasonV1,
	HistoryArchiveRepairSourceCandidateV1
} from 'shared';

const maxKnownGoodSources = 5;

export type HistoryArchiveRemoteReplacementCandidate =
	HistoryArchiveRepairSourceCandidateV1;

export function createRemoteReplacementCandidates(
	objects: readonly HistoryArchiveObject[],
	bucketSources: readonly HistoryArchiveVerifiedBucketSource[],
	checkpointSources: readonly HistoryArchiveVerifiedCheckpointObjectSource[]
): ReadonlyMap<string, readonly HistoryArchiveRemoteReplacementCandidate[]> {
	const checkpointSourcesByObject = new Map<
		string,
		HistoryArchiveVerifiedCheckpointObjectSource[]
	>();
	for (const source of checkpointSources) {
		const candidates =
			checkpointSourcesByObject.get(source.targetRemoteId) ?? [];
		candidates.push(source);
		checkpointSourcesByObject.set(source.targetRemoteId, candidates);
	}
	const bucketSourcesByObject = new Map<
		string,
		HistoryArchiveVerifiedBucketSource[]
	>();
	for (const source of bucketSources) {
		const candidates = bucketSourcesByObject.get(source.targetRemoteId) ?? [];
		candidates.push(source);
		bucketSourcesByObject.set(source.targetRemoteId, candidates);
	}

	return new Map(
		objects.map((object) => {
			const candidates =
				object.bucketHash === null
					? (checkpointSourcesByObject.get(object.remoteId) ?? []).map(
							toCheckpointCandidate
						)
					: (bucketSourcesByObject.get(object.remoteId) ?? [])
							.filter(
								(source) =>
									source.archiveUrlIdentity !== object.archiveUrlIdentity &&
									source.bucketHash === object.bucketHash?.toLowerCase()
							)
							.map(toBucketCandidate);
			return [object.remoteId, candidates.slice(0, maxKnownGoodSources)];
		})
	);
}

export function isRepairableObjectFailure(
	object: HistoryArchiveObject
): boolean {
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

export function toObjectRepairAction(
	object: HistoryArchiveObject,
	remoteCandidates: readonly HistoryArchiveRemoteReplacementCandidate[],
	repairArtifacts: ReadonlyMap<
		string,
		HistoryArchiveRepairArtifactAvailabilityV1
	>
): readonly HistoryArchiveRepairActionV1[] {
	if (getObjectEvidenceClass(object) !== 'archive-object') return [];
	if (
		object.objectType === 'history-archive-state' &&
		remoteCandidates.length === 0
	) {
		return [];
	}

	const kind = getObjectActionKind(object);
	const repairArtifact = getRepairArtifact(
		object,
		remoteCandidates[0],
		repairArtifacts
	);
	const replacementReady =
		remoteCandidates.length > 0 &&
		(repairArtifact?.status === 'available' ||
			repairArtifact?.status === 'verify-on-download');

	return [
		{
			actionId: `${kind}:${object.remoteId}`,
			bucketHash: object.bucketHash,
			checkpointEvidence: [],
			checkpointLedger: object.checkpointLedger,
			evidence: [toObjectEvidence(object)],
			kind,
			knownGoodSources: remoteCandidates,
			reason: getObjectRepairReason(object),
			repairArtifact,
			severity: replacementReady ? 'error' : 'blocked',
			summary: replacementReady
				? getReadyObjectActionSummary(
						object,
						kind,
						remoteCandidates[0],
						repairArtifact
					)
				: getBlockedObjectActionSummary(object, remoteCandidates)
		}
	];
}

function getRepairArtifact(
	object: HistoryArchiveObject,
	candidate: HistoryArchiveRemoteReplacementCandidate | undefined,
	repairArtifacts: ReadonlyMap<
		string,
		HistoryArchiveRepairArtifactAvailabilityV1
	>
): HistoryArchiveRepairArtifactAvailabilityV1 | null {
	if (object.bucketHash !== null) {
		const localArtifact =
			repairArtifacts.get(object.bucketHash.toLowerCase()) ??
			deferredRepairArtifact(object.bucketHash.toLowerCase());
		if (localArtifact.status !== 'unavailable' || candidate === undefined) {
			return localArtifact;
		}
	}
	if (candidate === undefined) return null;
	return toRemoteRepairArtifact({
		artifactType: object.objectType,
		candidateRemoteId: candidate.proof.candidateObjectRemoteId,
		contentHash: candidate.proof.contentHash,
		objectIdentity: object.objectKey,
		proofId: candidate.proof.proofId,
		proofVersion: candidate.proof.proofVersion,
		provenAt: candidate.proof.evaluatedAt,
		targetRemoteId: object.remoteId
	});
}

export function toCheckpointRepairAction(
	proof: HistoryArchiveCheckpointProof
): readonly HistoryArchiveRepairActionV1[] {
	if (proof.status !== 'mismatch') return [];

	const reason = getCheckpointRepairReason(proof.failureKind);
	if (reason === 'object-incomplete' || reason === 'proof-facts-incomplete') {
		return [];
	}

	return [
		{
			actionId: `checkpoint-diagnostic:${proof.archiveUrlIdentity}:${proof.checkpointLedger}`,
			bucketHash: null,
			checkpointEvidence: [toCheckpointEvidence(proof)],
			checkpointLedger: proof.checkpointLedger,
			evidence: [],
			kind: 'wait-for-scanner-proof',
			knownGoodSources: [],
			reason,
			repairArtifact: null,
			severity: 'blocked',
			summary: `${getCheckpointActionSummary(
				proof.checkpointLedger,
				reason
			)} This aggregate mismatch does not identify one safe replacement file; use the object evidence before changing archive data.`
		}
	];
}

export function toRepairInfrastructureBlock(
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

export function isArchiveObjectEvidence(object: HistoryArchiveObject): boolean {
	return getObjectEvidenceClass(object) === 'archive-object';
}

function toBucketCandidate(
	source: HistoryArchiveVerifiedBucketSource
): HistoryArchiveRemoteReplacementCandidate {
	return toSourceCandidate(source);
}

function toCheckpointCandidate(
	source: HistoryArchiveVerifiedCheckpointObjectSource
): HistoryArchiveRemoteReplacementCandidate {
	return toSourceCandidate(source);
}

function toSourceCandidate(
	source:
		| HistoryArchiveVerifiedBucketSource
		| HistoryArchiveVerifiedCheckpointObjectSource
): HistoryArchiveRepairSourceCandidateV1 {
	return {
		archiveUrl: source.archiveUrl,
		archiveUrlIdentity: source.archiveUrlIdentity,
		objectUrl: source.objectUrl,
		proof: {
			anchor: {
				kind: source.anchorKind,
				sourceCount: source.corroboratingSourceCount
			},
			candidateObjectRemoteId: source.candidateRemoteId,
			checkpointLedger: source.checkpointLedger,
			contentHash: {
				algorithm: 'sha256',
				digest: source.contentDigest,
				representation: source.contentRepresentation
			},
			evaluatedAt: source.proofEvaluatedAt.toISOString(),
			kind: 'strict-checkpoint',
			proofId: source.proofId.toString(),
			proofVersion: source.proofVersion
		},
		verifiedAt: source.verifiedAt?.toISOString() ?? null
	};
}

function getReadyObjectActionSummary(
	object: HistoryArchiveObject,
	kind: HistoryArchiveRepairActionKindV1,
	remoteCandidate: HistoryArchiveRemoteReplacementCandidate | undefined,
	repairArtifact: HistoryArchiveRepairArtifactAvailabilityV1 | null
): string {
	const proof = [];
	if (remoteCandidate !== undefined) {
		proof.push(getRemoteCandidateExplanation(object, remoteCandidate));
	}
	if (
		repairArtifact?.status === 'available' ||
		repairArtifact?.status === 'verify-on-download'
	) {
		proof.push(
			`A strict source proof verified the ${repairArtifact.contentHash.representation} SHA-256 ${repairArtifact.contentHash.digest} at ${repairArtifact.provenAt}; StellarAtlas checks the replacement bytes against that digest before returning the download.`
		);
	}
	return `${getObjectActionSummary(object, kind)} ${proof.join(' ')}`;
}

function getRemoteCandidateExplanation(
	object: HistoryArchiveObject,
	remoteCandidate: HistoryArchiveRemoteReplacementCandidate
): string {
	const source = remoteCandidate.archiveUrlIdentity;
	const proof = remoteCandidate.proof;
	return `The candidate from ${source} is bound to strict checkpoint proof v${proof.proofVersion} at checkpoint ${proof.checkpointLedger}; its ${proof.contentHash.representation} SHA-256 is ${proof.contentHash.digest}. The candidate URL is only a retrieval location.`;
}

function getBlockedObjectActionSummary(
	object: HistoryArchiveObject,
	remoteCandidates: readonly HistoryArchiveRemoteReplacementCandidate[] = []
): string {
	if (remoteCandidates.length > 0) {
		return 'A proof-bound source exists, but replacement bytes have not been locally reverified, so download remains blocked.';
	}
	if (object.objectType === 'bucket') {
		return 'Bucket failure evidence is confirmed, but no source bound to a strict checkpoint proof is available yet.';
	}
	const objectLabel = getObjectTypeLabel(object.objectType);
	return `${objectLabel.charAt(0).toUpperCase()}${objectLabel.slice(1)} evidence is confirmed, but no proven-good replacement source is available yet.`;
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
