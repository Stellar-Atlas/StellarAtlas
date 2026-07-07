import type {
	PublicHistoryArchiveObject,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveScanLogError
} from '../api/types';

const verificationErrorType = 'TYPE_VERIFICATION';

export const isArchiveVerificationError = (
	error:
		| PublicHistoryArchiveScanLogError
		| PublicHistoryArchiveScan['errors'][number]
): boolean => error.type === verificationErrorType;

export const getArchiveVerificationErrors = (
	errors: readonly (
		| PublicHistoryArchiveScanLogError
		| PublicHistoryArchiveScan['errors'][number]
	)[]
): PublicHistoryArchiveScanLogError[] =>
	errors.filter(isArchiveVerificationError).map((error) => ({
		message: error.message,
		type: error.type,
		url: error.url
	}));

export const getWorkerIssues = (
	errors: readonly (
		| PublicHistoryArchiveScanLogError
		| PublicHistoryArchiveScan['errors'][number]
	)[]
): PublicHistoryArchiveScanLogError[] =>
	errors
		.filter((error) => !isArchiveVerificationError(error))
		.map((error) => ({
			message: error.message,
			type: error.type,
			url: error.url
		}));

export const scanLogHasArchiveVerificationError = (
	entry: PublicHistoryArchiveScanLogEntry
): boolean =>
	entry.errors.some(isArchiveVerificationError) ||
	(entry.errors.length === 0 && entry.hasArchiveVerificationError === true);

export const scanLogHasWorkerIssue = (
	entry: PublicHistoryArchiveScanLogEntry
): boolean =>
	entry.errors.some((error) => !isArchiveVerificationError(error)) ||
	entry.hasWorkerIssue === true;

export const scanLogHasWorkerIssueOnly = (
	entry: PublicHistoryArchiveScanLogEntry
): boolean =>
	!scanLogHasArchiveVerificationError(entry) && scanLogHasWorkerIssue(entry);

export const scanLogIsActive = (
	entry: PublicHistoryArchiveScanLogEntry
): boolean =>
	entry.status === 'queued' ||
	entry.status === 'scanning' ||
	entry.status === 'starting' ||
	entry.status === 'stale';

export type ArchiveObjectType = PublicHistoryArchiveObject['objectType'];

export function formatArchiveObjectTypeLabel(type: ArchiveObjectType): string {
	if (type === 'history-archive-state') return 'History archive state';
	if (type === 'checkpoint-state') return 'Checkpoint history file';
	if (type === 'ledger') return 'Ledger archive file';
	if (type === 'transactions') return 'Transaction archive file';
	if (type === 'results') return 'Result archive file';
	if (type === 'scp') return 'SCP archive file';
	if (type === 'bucket') return 'Bucket file';
	return type;
}

export function formatArchiveObjectTypeGroupLabel(
	type: ArchiveObjectType
): string {
	if (type === 'history-archive-state') return 'History archive state files';
	if (type === 'checkpoint-state') return 'Checkpoint history files';
	if (type === 'ledger') return 'Ledger archive files';
	if (type === 'transactions') return 'Transaction archive files';
	if (type === 'results') return 'Result archive files';
	if (type === 'scp') return 'SCP archive files';
	if (type === 'bucket') return 'Bucket files';
	return type;
}

export function formatArchiveObjectTypeRole(type: ArchiveObjectType): string {
	if (type === 'history-archive-state') return 'latest checkpoint pointer';
	if (type === 'checkpoint-state') return 'checkpoint file list';
	if (type === 'bucket') return 'deduplicated state file';
	return 'checkpoint-range file';
}

export function formatArchiveObjectStatusLabel(
	status:
		| PublicHistoryArchiveObject['status']
		| 'claimed'
		| 'delayed'
		| 'heartbeat'
		| 'released'
): string {
	if (status === 'delayed') return 'delayed';
	if (status === 'scanning' || status === 'claimed' || status === 'heartbeat') {
		return 'checking';
	}
	if (status === 'verified') return 'verified';
	if (status === 'failed') return 'failed';
	if (status === 'released') return 'waiting';
	return 'waiting';
}

export function formatArchiveWorkerStageLabel(stage: string | null): string {
	if (stage === null || stage.length === 0) return '';
	if (stage.includes('download')) return 'downloading';
	if (stage.includes('hash') || stage.includes('verify')) return 'verifying';
	if (stage.includes('parse')) return 'parsing';
	if (stage.includes('claim')) return 'checking';
	if (stage.includes('release')) return 'waiting';
	if (stage.includes('backoff')) return 'waiting';
	return stage.replaceAll('_', ' ');
}

export function formatArchiveErrorTypeLabel(type: string): string {
	if (type === verificationErrorType) return 'Archive file evidence';
	if (type.toLowerCase().includes('http')) return 'Archive HTTP evidence';
	if (type.toLowerCase().includes('worker')) return 'Scanner infrastructure';
	return 'Scanner evidence';
}

export function sanitizeArchiveEvidenceText(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"<>)]*/g,
		'[internal path]'
	);
}
