import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PageHeading } from '@components/layout/page-heading';
import { ExplorerEntityBrowser } from '@components/blockchain/explorer-entity-browser';
import { ExplorerEntityNavigation } from '@components/blockchain/explorer-entity-navigation';
import { ExplorerRecordLookup } from '@components/blockchain/explorer-record-lookup';
import { ExplorerTransactionDetail } from '@components/blockchain/explorer-transaction-detail';
import { TransferActivityPanel } from '@components/analytics/transfer-activity-panel';
import { isAnalyticsCollection } from '../../../api/explorer-analytics';
import { explorerRouteFilters } from '../../../api/explorer-search-route';
interface Props {
	readonly params: Promise<{ segments: string[] }>;
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}
async function EntityRoute({
	params,
	searchParams
}: Props): Promise<React.JSX.Element> {
	const { segments } = await params;
	const query = await searchParams;
	const [collection, identifier] = segments;
	if (!collection || segments.length > 2) notFound();
	const filters = explorerRouteFilters(query);
	if (isAnalyticsCollection(collection))
		return (
			<ExplorerEntityBrowser
				collection={collection}
				identifier={identifier}
				initialFilters={filters}
			/>
		);
	if (collection === 'transfers' && !identifier)
		return (
			<>
				<ExplorerEntityNavigation active="transfers" />
				<TransferActivityPanel initialFilters={filters} />
			</>
		);
	if ((collection === 'accounts' || collection === 'ledgers') && identifier)
		return (
			<ExplorerRecordLookup collection={collection} identifier={identifier} />
		);
	if (collection === 'transactions' && identifier)
		return (
			<ExplorerTransactionDetail
				hash={identifier}
				ledgerSequence={filters.ledger_sequence}
			/>
		);
	notFound();
}
export default function ExplorerEntityPage(props: Props): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				title="Explorer"
				eyebrow="Stellar history"
				description="Explore transactions, assets, contracts, operations, trades and offers."
			/>
			<Suspense fallback={<p role="status">Loading explorer…</p>}>
				<EntityRoute {...props} />
			</Suspense>
		</main>
	);
}
