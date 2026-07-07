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
	if (type === 'history-archive-state') return 'Archive state';
	if (type === 'checkpoint-state') return 'Checkpoint state';
	if (type === 'ledger') return 'Ledger category';
	if (type === 'transactions') return 'Transaction category';
	if (type === 'results') return 'Result category';
	if (type === 'scp') return 'SCP category';
	if (type === 'bucket') return 'Bucket payload';
	return type;
}

export function formatArchiveObjectTypeGroupLabel(
	type: ArchiveObjectType
): string {
	if (type === 'history-archive-state') return 'Archive state checks';
	if (type === 'checkpoint-state') return 'Checkpoint state checks';
	if (type === 'ledger') return 'Ledger category checks';
	if (type === 'transactions') return 'Transaction category checks';
	if (type === 'results') return 'Result category checks';
	if (type === 'scp') return 'SCP category checks';
	if (type === 'bucket') return 'Bucket payload checks';
	return type;
}

export function formatArchiveObjectTypeRole(type: ArchiveObjectType): string {
	if (type === 'history-archive-state') return 'root history JSON';
	if (type === 'checkpoint-state') return 'checkpoint history JSON';
	if (type === 'bucket') return 'content-addressed bucket object';
	return 'checkpoint category file';
}

export function sanitizeArchiveEvidenceText(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"<>)]*/g,
		'[internal path]'
	);
}
