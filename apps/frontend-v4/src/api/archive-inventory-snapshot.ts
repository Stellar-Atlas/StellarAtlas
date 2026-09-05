import type {
	PublicHistoryArchiveStatusSummary,
	PublicNode,
	PublicOrganization
} from './types';

export interface ArchiveInventorySnapshot {
	readonly summary: PublicHistoryArchiveStatusSummary;
	readonly nodes: readonly PublicNode[];
	readonly organizations: readonly PublicOrganization[];
}

export interface ArchiveInventoryState {
	readonly snapshot: ArchiveInventorySnapshot | null;
	readonly error: string | null;
}

export function archiveInventoryRefreshFailed(
	previous: ArchiveInventoryState
): ArchiveInventoryState {
	return {
		snapshot: previous.snapshot,
		error: previous.snapshot
			? 'Live archive updates are temporarily unavailable. Showing the last successful snapshot; recorded archive failures remain visible.'
			: 'Archive data is temporarily unavailable. This does not indicate that any archive passed or failed verification.'
	};
}

export function archiveInventoryRefreshSucceeded(
	previous: ArchiveInventoryState,
	snapshot: ArchiveInventorySnapshot
): ArchiveInventoryState {
	const incomingTime = Date.parse(snapshot.summary.generatedAt);
	if (!Number.isFinite(incomingTime))
		return archiveInventoryRefreshFailed(previous);
	const previousTime = previous.snapshot
		? Date.parse(previous.snapshot.summary.generatedAt)
		: Number.NEGATIVE_INFINITY;
	// Separate page/API cache entries can briefly return out of order.
	// Compare timestamps, not counters: successful retries can reduce failures.
	if (incomingTime < previousTime) return previous;
	return { snapshot, error: null };
}
