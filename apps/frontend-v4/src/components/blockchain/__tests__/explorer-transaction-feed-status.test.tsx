/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecentTransactions } from '@api/types';
import { RecentTransactionsView } from '../blockchain-explorer-results';
import { ExplorerTransactionFeedStatus } from '../explorer-transaction-feed-status';

describe('ExplorerTransactionFeedStatus', () => {
	it('shows only the updated time for a fresh feed', () => {
		const html = render(feed());

		expect(html).toContain('Updated');
		expect(html).toContain('8/1/2026');
		expect(html).not.toMatch(implementationCopy);
	});

	it('shows a plain delayed warning for stale data', () => {
		const html = render(
			feed({
				freshness: 'stale',
				selectionReason: 'live_network_unavailable'
			})
		);

		expect(html).toContain('Transaction updates are delayed');
		expect(html).toContain('Last updated');
		expect(html).not.toMatch(implementationCopy);
	});

	it('does not expose source selection when a fresh alternate feed is used', () => {
		const html = render(
			feed({
				selectionReason: 'local_history_behind',
				source: 'live_network'
			})
		);

		expect(html).toContain('Updated');
		expect(html).not.toMatch(implementationCopy);
	});

	it('shows a plain unavailable warning when no data-through time exists', () => {
		const html = render(
			feed({
				dataThrough: null,
				freshness: 'unknown',
				selectionReason: 'local_history_empty',
				source: 'live_network'
			})
		);

		expect(html).toContain('Transaction updates are temporarily unavailable');
		expect(html).not.toMatch(implementationCopy);
	});

	it.each([
		['local_history', 'StellarAtlas historical records'],
		['live_network', 'Stellar public API']
	] as const)(
		'labels %s records without promising live data',
		(source, label) => {
			const html = renderToStaticMarkup(
				<RecentTransactionsView
					onInspect={() => undefined}
					result={{
						message: null,
						status: 'loaded',
						transactions: feed({ source })
					}}
				/>
			);

			expect(html).toContain(`Source: ${label}.`);
			expect(html).not.toContain('Live transactions');
		}
	);

	it('describes live rows without claiming they came from an index', () => {
		const html = renderToStaticMarkup(
			<RecentTransactionsView
				onInspect={() => undefined}
				result={{
					message: null,
					status: 'loaded',
					transactions: feed({ records: [transaction()], truncated: true })
				}}
			/>
		);

		expect(html).toContain('Showing the latest 1 transactions.');
		expect(html).not.toMatch(/indexed rows|returned by this query/iu);
	});
});

const implementationCopy =
	/local history|fallback|read model|live network|source selection|freshness|slo|window|horizon|postgres/iu;

function render(transactions: PublicRecentTransactions): string {
	return renderToStaticMarkup(
		<ExplorerTransactionFeedStatus transactions={transactions} />
	);
}

function feed(
	overrides: Partial<PublicRecentTransactions> = {}
): PublicRecentTransactions {
	return {
		dataThrough: '2026-08-01T11:59:30.000Z',
		freshness: 'fresh',
		freshnessThresholdMs: 300_000,
		generatedAt: '2026-08-01T12:00:00.000Z',
		limit: 20,
		records: [],
		selectionReason: 'local_history_current',
		source: 'local_history',
		truncated: false,
		...overrides
	};
}

function transaction(): PublicRecentTransactions['records'][number] {
	return {
		createdAt: '2026-08-01T11:59:30.000Z',
		feeCharged: '100',
		hash: 'a'.repeat(64),
		ledger: '123',
		operationCount: 1,
		sourceAccount: `G${'A'.repeat(55)}`,
		successful: true
	};
}
