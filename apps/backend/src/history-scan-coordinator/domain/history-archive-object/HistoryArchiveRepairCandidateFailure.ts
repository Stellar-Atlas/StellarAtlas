import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass
} from './HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveObjectFailureChannelDTO } from 'history-scanner-dto';

export interface HistoryArchiveRepairFailureEvidence {
	readonly errorMessage: string | null;
	readonly errorType: string | null;
	readonly failureChannel: string | null;
	readonly httpStatus: number | null;
}

export function isHistoryArchiveRepairCandidateFailure(
	evidence: HistoryArchiveRepairFailureEvidence
): boolean {
	return (
		isHistoryArchiveRepairableIntegrityFailure(evidence) ||
		isHistoryArchiveProofGatedMissingFailure(evidence)
	);
}

export function isHistoryArchiveRepairableIntegrityFailure(
	evidence: HistoryArchiveRepairFailureEvidence
): boolean {
	if (!isArchiveObjectEvidence(evidence)) return false;
	const failureClass = classify(evidence);
	if (
		failureClass === 'auth' ||
		failureClass === 'http' ||
		failureClass === 'not-found' ||
		failureClass === 'rate-limit' ||
		failureClass === 'timeout' ||
		failureClass === 'transport' ||
		failureClass === 'worker' ||
		failureClass === 'coordinator'
	) {
		return false;
	}

	const errorType = (evidence.errorType ?? '').trim().toLowerCase();
	const errorMessage = (evidence.errorMessage ?? '').trim().toLowerCase();
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

export function isHistoryArchiveProofGatedMissingFailure(
	evidence: HistoryArchiveRepairFailureEvidence
): boolean {
	return (
		isArchiveObjectEvidence(evidence) &&
		classify(evidence) === 'not-found' &&
		!(evidence.errorMessage ?? '').toLowerCase().includes('abort')
	);
}

function isArchiveObjectEvidence(
	evidence: HistoryArchiveRepairFailureEvidence
): boolean {
	const failureClass = classify(evidence);
	const failureChannel = normalizeFailureChannel(
		evidence.failureChannel,
		failureClass
	);
	return (
		failureChannel !== null &&
		getHistoryArchiveObjectEvidenceClass(failureClass, failureChannel) ===
			'archive-object'
	);
}

function normalizeFailureChannel(
	value: string | null,
	failureClass: ReturnType<typeof classify>
): HistoryArchiveObjectFailureChannelDTO | null {
	if (
		value === 'archive_evidence' ||
		value === 'archive_availability' ||
		value === 'scanner_issue'
	) {
		return value;
	}
	if (value !== null) return null;
	return failureClass === 'worker' || failureClass === 'coordinator'
		? 'scanner_issue'
		: 'archive_evidence';
}

function classify(evidence: HistoryArchiveRepairFailureEvidence) {
	return classifyHistoryArchiveObjectFailure({
		errorType: evidence.errorType,
		httpStatus: evidence.httpStatus
	});
}
