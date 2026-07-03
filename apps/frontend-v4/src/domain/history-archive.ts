import type {
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
): boolean => entry.status === 'queued' || entry.status === 'scanning';
