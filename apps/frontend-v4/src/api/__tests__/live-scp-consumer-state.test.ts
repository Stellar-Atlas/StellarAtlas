import type {
	PublicScpGraphStatement,
	PublicScpStatementObservation
} from '../types';
import {
	applyLiveScpMessage,
	createLiveScpConsumerState
} from '../live-scp-consumer-state';

describe('live SCP consumer state', () => {
	it.each(['fresh', 'stale', 'empty', 'unavailable'] as const)(
		'retains %s metadata from a metadata-only update',
		(freshness) => {
			const statement = createStatement('statement-a');
			const initial = createLiveScpConsumerState([toGraphStatement(statement)]);

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
			expect(next.statements).toEqual([toGraphStatement(statement)]);
		}
	);

	it('merges statement deltas while updating the source metadata', () => {
		const current = createLiveScpConsumerState([
			toGraphStatement(
				createStatement('statement-a', '2026-07-05T00:00:00.000Z')
			)
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
		expect(next.statements[0]).toMatchObject({
			quorumSetHash: 'quorum-statement-b',
			values: [{ upgradeCount: 1, value: 'value-statement-b' }]
		});
	});

	it('keeps the last meaningful metadata when a cursor poll has no new rows', () => {
		const initial = applyLiveScpMessage(createLiveScpConsumerState([]), {
			cursor: { observedAtMs: 1_783_209_601_000, statementHash: 'statement-a' },
			freshness: 'fresh',
			freshnessMs: 500,
			observedAt: '2026-07-05T00:00:01.000Z',
			payload: [createStatement('statement-a', '2026-07-05T00:00:01.000Z')],
			source: 'postgres_canonical',
			truncated: true,
			type: 'scp'
		});

		const next = applyLiveScpMessage(initial, {
			cursor: { observedAtMs: 1_783_209_602_000, statementHash: 'statement-b' },
			freshness: 'empty',
			freshnessMs: null,
			observedAt: null,
			payload: [],
			source: 'meilisearch',
			truncated: false,
			type: 'scp'
		});

		expect(next.metadata).toEqual({
			cursor: { observedAtMs: 1_783_209_602_000, statementHash: 'statement-b' },
			freshness: 'fresh',
			freshnessMs: 500,
			observedAt: '2026-07-05T00:00:01.000Z',
			source: 'postgres_canonical',
			truncated: false
		});
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
		pledges: {
			accepted: [],
			quorumSetHash: `quorum-${statementHash}`,
			votes: []
		},
		signature: '',
		slotIndex: '63326550',
		statementHash,
		statementType: 'nominate',
		statementXdr: '',
		values: [
			{
				closeTime: observedAt,
				txSetHash: `tx-${statementHash}`,
				upgradeCount: 1,
				value: `value-${statementHash}`
			}
		]
	};
}

function toGraphStatement(
	statement: PublicScpStatementObservation
): PublicScpGraphStatement {
	return {
		nodeId: statement.nodeId,
		observedAt: statement.observedAt,
		observedFromPeer: statement.observedFromPeer,
		quorumSetHash: statement.pledges.quorumSetHash,
		slotIndex: statement.slotIndex,
		statementHash: statement.statementHash,
		statementType: statement.statementType,
		values: statement.values
	};
}
