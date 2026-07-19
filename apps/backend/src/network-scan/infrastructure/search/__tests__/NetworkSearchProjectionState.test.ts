import {
	createNetworkSearchIndexState,
	networkSearchProjectionCanServe,
	networkSearchProjectionMaxAgeMs,
	networkSearchStateMatchesSnapshot
} from '../NetworkSearchProjectionState.js';
import type { NetworkSearchSnapshot } from '../NetworkSearchTypes.js';

describe('network search projection state', () => {
	const nowMs = Date.parse('2026-07-19T00:10:00.000Z');
	const snapshot: NetworkSearchSnapshot = {
		canonicalArchiveRevision: 'archive-revision',
		canonicalCursor: 'canonical-cursor',
		documents: [],
		generatedAt: '2026-07-19T00:09:58.000Z',
		networkTime: '2026-07-19T00:09:55.000Z'
	};

	it('serves a recent matching generation', () => {
		const state = createNetworkSearchIndexState(
			snapshot,
			new Date(nowMs - networkSearchProjectionMaxAgeMs).toISOString()
		);

		expect(networkSearchProjectionCanServe(state, undefined, nowMs)).toBe(true);
		expect(
			networkSearchProjectionCanServe(state, snapshot.canonicalCursor, nowMs)
		).toBe(true);
		expect(networkSearchStateMatchesSnapshot(state, snapshot)).toBe(true);
	});

	it('rejects expired, future, and cursor-mismatched generations', () => {
		const expired = createNetworkSearchIndexState(
			snapshot,
			new Date(nowMs - networkSearchProjectionMaxAgeMs - 1).toISOString()
		);
		const future = createNetworkSearchIndexState(
			snapshot,
			new Date(nowMs + 1).toISOString()
		);

		expect(networkSearchProjectionCanServe(expired, undefined, nowMs)).toBe(
			false
		);
		expect(networkSearchProjectionCanServe(future, undefined, nowMs)).toBe(
			false
		);
		expect(
			networkSearchProjectionCanServe(expired, 'other-cursor', nowMs)
		).toBe(false);
	});
});
