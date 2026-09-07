import { isHistoryArchiveInconclusiveTransportFailure } from 'shared';
import type { ArchiveSource } from './archive-inventory-model';
type Source = Pick<ArchiveSource, 'archiveEvidenceFailures' | 'failureSummary'>;
export function getArchiveFaultGroups(source: Source) {
	return (source.failureSummary?.groups ?? []).filter((reason) =>
		reason.attribution
			? reason.attribution === 'archive_fault'
			: !isHistoryArchiveInconclusiveTransportFailure(reason)
	);
}
export function getArchiveFaultCount(source: Source): number | null {
	if (source.archiveEvidenceFailures === 0) return 0;
	const summary = source.failureSummary;
	if (!summary || summary.status === 'unavailable') return null;
	const value = summary.archiveFaultCount;
	if (
		value != null &&
		(value > 0 || summary.remoteFailureCount === source.archiveEvidenceFailures)
	)
		return value;
	// Older uncapped snapshots can be classified without inventing missing groups.
	if (
		summary.remoteFailureCount === source.archiveEvidenceFailures &&
		summary.groups.reduce((n, group) => n + group.count, 0) ===
			summary.remoteFailureCount
	)
		return getArchiveFaultGroups(source).reduce(
			(n, group) => n + group.count,
			0
		);
	return null;
}
