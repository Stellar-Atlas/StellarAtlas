import { parseLiveNetworkMessage } from '../live-network-message-parser';
import type { PublicScpStatementObservation } from '../types';

describe('parseLiveNetworkMessage', () => {
	it.each(['fresh', 'stale', 'empty', 'unavailable'] as const)(
		'accepts truthful %s SCP metadata',
		(freshness) => {
			const hasObservation = freshness === 'fresh' || freshness === 'stale';
			const message = {
				freshness,
				freshnessMs: hasObservation ? 1_000 : null,
				observedAt: hasObservation ? '2026-07-05T00:00:00.000Z' : null,
				payload: [],
				source: freshness === 'fresh' ? 'meilisearch' : 'postgres_canonical',
				type: 'scp'
			};

			expect(parseLiveNetworkMessage(message)).toEqual(message);
		}
	);

	it('accepts a stale nonempty page with an invalid statement timestamp', () => {
		const statement = createStatement();
		statement.observedAt = 'invalid-remote-timestamp';

		const parsed = parseLiveNetworkMessage({
			freshness: 'stale',
			freshnessMs: null,
			observedAt: null,
			payload: [statement],
			source: 'postgres_canonical',
			type: 'scp'
		});

		expect(parsed).toMatchObject({
			freshness: 'stale',
			payload: [{ observedAt: 'invalid-remote-timestamp' }],
			type: 'scp'
		});
	});

	it('preserves cursor, truncation, quorum-set, and value evidence', () => {
		const statement = createStatement();
		statement.pledges.quorumSetHash = 'quorum-a';
		statement.values = [
			{
				closeTime: '2026-07-05T00:00:00.000Z',
				txSetHash: 'tx-a',
				upgradeCount: 2,
				value: 'raw-value-a'
			}
		];
		const cursor = {
			observedAtMs: Date.parse('2026-07-05T00:00:00.000Z'),
			statementHash: 'statement-a'
		};

		expect(
			parseLiveNetworkMessage({
				cursor,
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:00.000Z',
				payload: [statement],
				source: 'postgres_canonical',
				truncated: true,
				type: 'scp'
			})
		).toMatchObject({
			cursor,
			payload: [
				{
					pledges: { quorumSetHash: 'quorum-a' },
					values: [{ upgradeCount: 2, value: 'raw-value-a' }]
				}
			],
			truncated: true
		});
	});

	it('accepts stale latest-ledger metadata', () => {
		expect(
			parseLiveNetworkMessage({
				payload: {
					closedAt: '2026-07-05T00:00:00.000Z',
					freshness: 'stale',
					freshnessMs: 60_000,
					observedAt: '2026-07-05T00:01:00.000Z',
					protocolVersion: 23,
					sequence: '63326550',
					source: 'horizon_fallback'
				},
				type: 'latestLedger'
			})
		).toMatchObject({ payload: { freshness: 'stale' }, type: 'latestLedger' });
	});

	it('accepts a structurally valid network snapshot', () => {
		const network = createNetwork();

		expect(
			parseLiveNetworkMessage({ payload: network, type: 'network' })
		).toEqual({ payload: network, type: 'network' });
	});

	it.each([
		{ freshness: 'unknown' },
		{ freshnessMs: -1 },
		{ observedAt: 'not-a-date' },
		{ source: 'unknown' }
	])('rejects invalid SCP metadata: $freshness$source', (override) => {
		expect(
			parseLiveNetworkMessage({
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:00.000Z',
				payload: [],
				source: 'meilisearch',
				type: 'scp',
				...override
			})
		).toBeNull();
	});

	it('rejects malformed SCP statement payloads', () => {
		expect(
			parseLiveNetworkMessage({
				freshness: 'fresh',
				freshnessMs: 1_000,
				observedAt: '2026-07-05T00:00:00.000Z',
				payload: [{ statementType: 'nominate' }],
				source: 'meilisearch',
				type: 'scp'
			})
		).toBeNull();
	});

	it('rejects nonempty pages labeled empty or unavailable', () => {
		for (const freshness of ['empty', 'unavailable']) {
			expect(
				parseLiveNetworkMessage({
					freshness,
					freshnessMs: null,
					observedAt: null,
					payload: [createStatement()],
					source: 'postgres_canonical',
					type: 'scp'
				})
			).toBeNull();
		}
	});

	it('rejects malformed network and unknown message types', () => {
		expect(
			parseLiveNetworkMessage({
				payload: { latestLedger: '1' },
				type: 'network'
			})
		).toBeNull();
		expect(parseLiveNetworkMessage({ payload: {}, type: 'other' })).toBeNull();
	});
});

function createStatement(): PublicScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: '2026-07-05T00:00:00.000Z',
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: { accepted: [], quorumSetHash: '', votes: [] },
		signature: '',
		slotIndex: '63326550',
		statementHash: 'statement-a',
		statementType: 'nominate',
		statementXdr: '',
		values: []
	};
}

function createNetwork() {
	return {
		id: 'public',
		latestLedger: '63326550',
		name: 'Public network',
		nodes: [],
		organizations: [],
		passPhrase: 'Public Global Stellar Network ; September 2015',
		scc: [],
		statistics: {
			hasQuorumIntersection: true,
			hasSymmetricTopTier: true,
			hasTransitiveQuorumSet: true,
			minBlockingSetCountryFilteredSize: 1,
			minBlockingSetCountrySize: 1,
			minBlockingSetFilteredSize: 1,
			minBlockingSetISPFilteredSize: 1,
			minBlockingSetISPSize: 1,
			minBlockingSetOrgsFilteredSize: 1,
			minBlockingSetOrgsSize: 1,
			minBlockingSetSize: 1,
			minSplittingSetCountrySize: 1,
			minSplittingSetISPSize: 1,
			minSplittingSetOrgsSize: 1,
			minSplittingSetSize: 1,
			nrOfActiveFullValidators: 1,
			nrOfActiveOrganizations: 1,
			nrOfActiveValidators: 1,
			nrOfActiveWatchers: 1,
			nrOfConnectableNodes: 1,
			time: '2026-07-05T00:00:00.000Z',
			topTierOrgsSize: 1,
			topTierSize: 1,
			transitiveQuorumSetSize: 1
		},
		time: '2026-07-05T00:00:00.000Z',
		transitiveQuorumSet: []
	};
}
