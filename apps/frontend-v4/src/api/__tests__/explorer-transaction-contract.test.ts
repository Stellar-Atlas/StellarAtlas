import { parseExplorerRecentTransactions } from '../explorer-transaction-contract';

describe('explorer recent transaction contract', () => {
	it('parses a current local-history feed', () => {
		expect(parseExplorerRecentTransactions(feed())).toEqual(feed());
	});

	it('parses an explicitly stale local feed after live refresh failure', () => {
		const value = feed({
			freshness: 'stale',
			selectionReason: 'live_network_unavailable',
			source: 'local_history'
		});

		expect(parseExplorerRecentTransactions(value)).toEqual(value);
	});

	it('parses an empty live feed with unknown freshness', () => {
		const value = feed({
			dataThrough: null,
			freshness: 'unknown',
			records: [],
			selectionReason: 'local_history_empty',
			source: 'live_network',
			truncated: false
		});

		expect(parseExplorerRecentTransactions(value)).toEqual(value);
	});

	it('rejects implementation-source names and incoherent selections', () => {
		expect(
			parseExplorerRecentTransactions({
				...feed(),
				source: 'postgres_canonical'
			})
		).toBeNull();
		expect(
			parseExplorerRecentTransactions({
				...feed(),
				selectionReason: 'local_history_current',
				source: 'live_network'
			})
		).toBeNull();
	});
});

function feed(
	overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
	return {
		dataThrough: '2026-08-01T11:59:30.000Z',
		freshness: 'fresh',
		freshnessThresholdMs: 300_000,
		generatedAt: '2026-08-01T12:00:00.000Z',
		limit: 20,
		records: [
			{
				createdAt: '2026-08-01T11:59:30.000Z',
				feeCharged: '100',
				hash: 'a'.repeat(64),
				ledger: '123',
				operationCount: 1,
				sourceAccount: `G${'A'.repeat(55)}`,
				successful: true
			}
		],
		selectionReason: 'local_history_current',
		source: 'local_history',
		truncated: true,
		...overrides
	};
}
