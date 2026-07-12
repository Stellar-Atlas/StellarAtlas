import type { PublicScpStatementObservation } from '../types';
import {
	applyLiveScpMessage,
	createLiveScpConsumerState
} from '../live-scp-consumer-state';

describe('live SCP consumer state', () => {
	it.each(['fresh', 'stale', 'empty', 'unavailable'] as const)(
		'retains %s metadata from a metadata-only update',
		(freshness) => {
			const statement = createStatement('statement-a');
			const initial = createLiveScpConsumerState([statement]);

			const next = applyLiveScpMessage(initial, {
				freshness,
				freshnessMs: freshness === 'fresh' ? 1_000 : null,
				observedAt: freshness === 'fresh' ? '2026-07-05T00:00:00.000Z' : null,
				payload: [],
				source: 'postgres_canonical',
				type: 'scp'
			});

			expect(next.metadata).toEqual({
				freshness,
				freshnessMs: freshness === 'fresh' ? 1_000 : null,
				observedAt: freshness === 'fresh' ? '2026-07-05T00:00:00.000Z' : null,
				source: 'postgres_canonical'
			});
			expect(next.statements).toEqual([statement]);
		}
	);

	it('merges statement deltas while updating the source metadata', () => {
		const current = createLiveScpConsumerState([
			createStatement('statement-a', '2026-07-05T00:00:00.000Z')
		]);

		const next = applyLiveScpMessage(current, {
			freshness: 'fresh',
			freshnessMs: 500,
			observedAt: '2026-07-05T00:00:01.000Z',
			payload: [createStatement('statement-b', '2026-07-05T00:00:01.000Z')],
			source: 'meilisearch',
			type: 'scp'
		});

		expect(next.metadata?.source).toBe('meilisearch');
		expect(next.statements.map(({ statementHash }) => statementHash)).toEqual([
			'statement-b',
			'statement-a'
		]);
	});
});

function createStatement(
	statementHash: string,
	observedAt = '2026-07-05T00:00:00.000Z'
): PublicScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt,
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash,
		statementType: 'nominate',
		statementXdr: '',
		values: []
	};
}
