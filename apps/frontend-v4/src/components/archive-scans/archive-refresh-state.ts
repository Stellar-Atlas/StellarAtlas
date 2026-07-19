import type { PublicHistoryArchiveState } from '@api/types';

export type ArchiveRefreshFailureAge =
	'current' | 'historical' | 'same-observation';

export function classifyArchiveRefreshFailure(
	state: PublicHistoryArchiveState
): ArchiveRefreshFailureAge | null {
	const failure = state.latestFailure;
	if (failure === null) return null;
	if (state.status !== 'available') return 'current';

	const successfulAt = Date.parse(
		state.metadata?.observedAt ?? state.observedAt
	);
	const failedAt = Date.parse(failure.observedAt);
	if (failedAt > successfulAt) return 'current';
	if (failedAt < successfulAt) return 'historical';
	return 'same-observation';
}

export function archiveRefreshFailureLabel(
	age: ArchiveRefreshFailureAge
): string {
	if (age === 'current') return 'Latest refresh failed';
	if (age === 'historical') return 'Previous refresh failure';
	return 'Refresh failure at stored-state observation time';
}
