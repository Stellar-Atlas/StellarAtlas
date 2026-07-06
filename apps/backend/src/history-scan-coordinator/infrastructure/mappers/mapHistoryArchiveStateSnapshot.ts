import type { HistoryArchiveStateSnapshot } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveStateSnapshotV1 } from 'shared';

export function mapHistoryArchiveStateSnapshot(
	snapshot: HistoryArchiveStateSnapshot
): HistoryArchiveStateSnapshotV1 {
	return {
		archiveUrl: snapshot.archiveUrl,
		archiveUrlIdentity: snapshot.archiveUrlIdentity,
		stateUrl: snapshot.stateUrl,
		status: snapshot.status,
		observedAt: snapshot.observedAt.toISOString(),
		source: snapshot.source,
		metadata: snapshot.toArchiveMetadata(),
		failure: snapshot.toFailure()
	};
}
