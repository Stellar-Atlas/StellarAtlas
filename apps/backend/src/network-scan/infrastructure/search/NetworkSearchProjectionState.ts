import type {
	NetworkSearchIndexStateDocument,
	NetworkSearchSnapshot
} from './NetworkSearchTypes.js';

export const networkSearchStateDocumentId = 'network_search_state';
export const networkSearchProjectionRefreshIntervalMs = 60_000;
export const networkSearchProjectionMaxAgeMs =
	3 * networkSearchProjectionRefreshIntervalMs;

export const createNetworkSearchIndexState = (
	snapshot: NetworkSearchSnapshot,
	indexedAt = new Date().toISOString()
): NetworkSearchIndexStateDocument => ({
	canonicalArchiveRevision: snapshot.canonicalArchiveRevision,
	canonicalCursor: snapshot.canonicalCursor,
	documentKind: 'state',
	id: networkSearchStateDocumentId,
	indexedAt,
	networkTime: snapshot.networkTime
});

export const isNetworkSearchIndexState = (
	state: NetworkSearchIndexStateDocument
): boolean =>
	state.documentKind === 'state' &&
	state.id === networkSearchStateDocumentId &&
	typeof state.canonicalArchiveRevision === 'string' &&
	state.canonicalArchiveRevision.length > 0 &&
	typeof state.canonicalCursor === 'string' &&
	state.canonicalCursor.length > 0 &&
	typeof state.indexedAt === 'string' &&
	Number.isFinite(Date.parse(state.indexedAt)) &&
	typeof state.networkTime === 'string' &&
	Number.isFinite(Date.parse(state.networkTime));

export const networkSearchStateMatchesSnapshot = (
	state: NetworkSearchIndexStateDocument,
	snapshot: NetworkSearchSnapshot
): boolean =>
	isNetworkSearchIndexState(state) &&
	state.canonicalArchiveRevision === snapshot.canonicalArchiveRevision &&
	state.canonicalCursor === snapshot.canonicalCursor &&
	state.networkTime === snapshot.networkTime;

export const networkSearchProjectionCanServe = (
	state: NetworkSearchIndexStateDocument,
	requestedCursor: string | undefined,
	nowMs = Date.now()
): boolean => {
	if (!isNetworkSearchIndexState(state)) return false;
	if (
		requestedCursor !== undefined &&
		requestedCursor !== state.canonicalCursor
	)
		return false;
	const ageMs = nowMs - Date.parse(state.indexedAt);
	return ageMs >= 0 && ageMs <= networkSearchProjectionMaxAgeMs;
};
