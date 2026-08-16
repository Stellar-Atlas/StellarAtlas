import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveVerifiedBucketSource,
	HistoryArchiveVerifiedCheckpointObjectSource
} from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass
} from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import {
	isHistoryArchiveProofGatedMissingFailure,
	isHistoryArchiveRepairableIntegrityFailure
} from '../../domain/history-archive-object/HistoryArchiveRepairCandidateFailure.js';

const sha256Pattern = /^[0-9a-f]{64}$/;

export function isRepairCandidateObjectFailure(
	object: HistoryArchiveObject
): boolean {
	return (
		isRepairableObjectFailure(object) ||
		isProofGatedMissingObjectFailure(object)
	);
}

export function isRepairableObjectFailure(
	object: HistoryArchiveObject
): boolean {
	return isHistoryArchiveRepairableIntegrityFailure(object);
}

export function isProofGatedMissingObjectFailure(
	object: HistoryArchiveObject
): boolean {
	return isHistoryArchiveProofGatedMissingFailure(object);
}

export function isStrictVerifiedRepairSource(
	object: HistoryArchiveObject,
	source:
		| HistoryArchiveVerifiedBucketSource
		| HistoryArchiveVerifiedCheckpointObjectSource
): boolean {
	if (
		source.targetRemoteId !== object.remoteId ||
		source.archiveUrlIdentity === object.archiveUrlIdentity ||
		object.checkpointLedger === null ||
		source.checkpointLedger !== object.checkpointLedger ||
		source.proofVersion !== CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION ||
		!sha256Pattern.test(source.contentDigest) ||
		!Number.isSafeInteger(source.proofId) ||
		source.proofId < 1 ||
		!isValidProofDate(source.verifiedAt) ||
		!isValidProofDate(source.proofEvaluatedAt) ||
		source.proofEvaluatedAt < source.verifiedAt
	) {
		return false;
	}

	if ('bucketHash' in source) {
		return (
			object.bucketHash !== null &&
			source.anchorKind === 'content-addressed-bucket' &&
			source.bucketHash === object.bucketHash.toLowerCase() &&
			source.contentDigest === source.bucketHash &&
			source.contentRepresentation === 'uncompressed-xdr'
		);
	}

	return (
		object.bucketHash === null &&
		hasExpectedCheckpointRepresentation(
			object.objectType,
			source.contentRepresentation
		) &&
		(source.anchorKind === 'target-digest' ||
			(source.anchorKind === 'multi-source' &&
				source.corroboratingSourceCount >= 2))
	);
}

function hasExpectedCheckpointRepresentation(
	objectType: HistoryArchiveObject['objectType'],
	representation: HistoryArchiveVerifiedCheckpointObjectSource['contentRepresentation']
): boolean {
	if (objectType === 'checkpoint-state') {
		return representation === 'canonical-json';
	}
	return (
		(objectType === 'ledger' ||
			objectType === 'transactions' ||
			objectType === 'results' ||
			objectType === 'scp') &&
		representation === 'uncompressed-xdr'
	);
}

export function isArchiveObjectEvidence(object: HistoryArchiveObject): boolean {
	return getRepairObjectEvidenceClass(object) === 'archive-object';
}

export function getRepairObjectFailureClass(object: HistoryArchiveObject) {
	return classifyHistoryArchiveObjectFailure({
		errorType: object.errorType,
		httpStatus: object.httpStatus
	});
}

export function getRepairObjectEvidenceClass(object: HistoryArchiveObject) {
	const failureClass = getRepairObjectFailureClass(object);
	return getHistoryArchiveObjectEvidenceClass(
		failureClass,
		object.failureChannel ??
			(failureClass === 'worker' || failureClass === 'coordinator'
				? 'scanner_issue'
				: 'archive_evidence')
	);
}

function isValidProofDate(value: Date): boolean {
	return !Number.isNaN(value.getTime());
}
