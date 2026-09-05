import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveStatusSummary
} from '@api/types';
import { sanitizeArchiveEvidenceText } from '@domain/history-archive';
import { formatInteger } from '@format/formatters';
type ArchiveEvent = PublicHistoryArchiveObjectEvents['events'][number];
type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];

export function hasIntegrityMismatch(source: ArchiveSource): boolean {
	return source.mismatchCheckpointProofs > 0;
}

export function formatSourceIntegrity(source: ArchiveSource): string {
	if (source.mismatchCheckpointProofs > 0) {
		return `${formatInteger(source.mismatchCheckpointProofs)} confirmed mismatches`;
	}
	if (source.unclassifiedFailures > 0) {
		return 'Not evaluated for legacy evidence';
	}
	return 'No confirmed mismatch';
}

export function formatRemoteAvailability(source: ArchiveSource): string {
	if (source.archiveEvidenceFailures > 0) {
		return `${formatInteger(source.archiveEvidenceFailures)} file checks awaiting retry`;
	}
	if (
		source.rootObjectStatus === 'failed' &&
		source.rootFailureChannel === 'archive_evidence'
	) {
		return 'Root file check awaiting retry';
	}
	if (source.stateStatus === 'unreachable')
		return 'Source currently unreachable';
	return 'No unresolved remote checks';
}

export function formatCheckpointCoverage(source: ArchiveSource): string {
	if (source.totalCheckpointProofs === 0) return 'No proof rows discovered yet';
	return `${formatInteger(source.verifiedCheckpointProofs)} / ${formatInteger(source.totalCheckpointProofs)} verified`;
}

export function formatSourceState(source: ArchiveSource): string {
	if (
		source.rootObjectStatus === 'failed' &&
		source.rootFailureChannel === 'archive_evidence'
	) {
		return 'State captured previously; latest root check awaiting retry';
	}
	if (
		source.rootObjectStatus === 'failed' &&
		source.rootFailureChannel === 'scanner_issue'
	) {
		return 'State captured previously; latest root check had a scanner issue';
	}
	if (source.rootObjectStatus === 'verified')
		return 'Latest root state verified';
	if (source.rootObjectStatus === 'scanning')
		return 'Checking latest root state';
	if (source.rootObjectStatus === 'pending') return 'Latest root check queued';
	return source.stateStatus === 'available'
		? 'State captured; root check not queued'
		: 'No current root state captured';
}

export function formatFailureDetail(event: ArchiveEvent): string {
	return formatArchiveFailureDetail(event.error);
}

export function formatArchiveFailureDetail(
	error: ArchiveEvent['error']
): string {
	return error === null
		? 'Failure detail not recorded'
		: sanitizeArchiveEvidenceText(error.message);
}

export function formatArchiveSourceLabel(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.protocol}//${url.host}${path}`;
	} catch {
		return sanitizeArchiveEvidenceText(value);
	}
}
