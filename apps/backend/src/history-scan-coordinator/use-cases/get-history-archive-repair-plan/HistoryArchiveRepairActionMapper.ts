import type { HistoryArchiveCheckpointProof } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
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
import { sanitizePublicInfrastructureText } from '../../infrastructure/mappers/PublicScanErrorMapper.js';
import { createHistoryArchiveRepairManifest } from './HistoryArchiveRepairManifestMapper.js';
import {
	getRepairObjectEvidenceClass,
	getRepairObjectFailureClass,
	isProofGatedMissingObjectFailure,
	isRepairCandidateObjectFailure,
	isRepairableObjectFailure,
	isStrictVerifiedRepairSource
} from './HistoryArchiveRepairEligibility.js';

export {
	isArchiveObjectEvidence,
	isRepairableObjectFailure
} from './HistoryArchiveRepairEligibility.js';

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
					? (checkpointSourcesByObject.get(object.remoteId) ?? [])
							.filter((source) => isStrictVerifiedRepairSource(object, source))
							.map(toCheckpointCandidate)
					: (bucketSourcesByObject.get(object.remoteId) ?? [])
							.filter((source) => isStrictVerifiedRepairSource(object, source))
							.map(toBucketCandidate);
			return [object.remoteId, candidates.slice(0, maxKnownGoodSources)];
		})
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
	if (
		!isRepairCandidateObjectFailure(object) ||
		getRepairObjectEvidenceClass(object) !== 'archive-object'
	) {
		return [];
	}
	const proofGatedMissing = isProofGatedMissingObjectFailure(object);
	if (proofGatedMissing && object.checkpointLedger === null) return [];

	const kind = getObjectActionKind(object);
	const repairArtifact = getRepairArtifact(
		object,
		remoteCandidates[0],
		repairArtifacts
	);
	const actionId = `${kind}:${object.remoteId}`;
	const evidence = toObjectEvidence(object);
	const repairManifest = createHistoryArchiveRepairManifest({
		actionId,
		artifact: repairArtifact,
		evidence,
		object,
		source: remoteCandidates[0]
	});
	const replacementReady = repairManifest.status === 'ready';
	return [
		{
			actionId,
			bucketHash: object.bucketHash,
			checkpointEvidence: [],
			checkpointLedger: object.checkpointLedger,
			evidence: [evidence],
			kind,
			knownGoodSources: remoteCandidates,
			repairManifest,
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
		targetEvidenceUpdatedAt: requireDate(object.updatedAt).toISOString(),
		targetFailureKind: isProofGatedMissingObjectFailure(object)
			? 'missing'
			: 'integrity',
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
			repairManifest: null,
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
		evidenceClass: getRepairObjectEvidenceClass(object),
		failureClass: getRepairObjectFailureClass(object),
		hostIdentity: object.hostIdentity,
		httpStatus: object.httpStatus,
		summary:
			'Scanner infrastructure must clear before this object can be evaluated.'
	};
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
	if (getRepairObjectFailureClass(object) === 'auth') {
		return getObjectActionSummary(object, getObjectActionKind(object));
	}

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
	const failureClass = getRepairObjectFailureClass(object);
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
	if (getRepairObjectFailureClass(object) === 'auth') {
		return `Restore anonymous HTTP GET and HEAD access to the exact case-sensitive ${getObjectTypeLabel(
			object.objectType
		)} path for checkpoint ${object.checkpointLedger ?? 'unknown'}. If this storage backend masks absent keys as HTTP 403, publish the proof-bound replacement at that exact path after preserving the existing object as a backup.`;
	}

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
		evidenceClass: getRepairObjectEvidenceClass(object),
		errorMessage:
			object.errorMessage === null
				? null
				: sanitizePublicInfrastructureText(object.errorMessage),
		errorType: object.errorType,
		failureClass: getRepairObjectFailureClass(object),
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
