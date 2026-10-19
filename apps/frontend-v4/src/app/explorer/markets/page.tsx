import { Suspense } from 'react';
import { PageHeading } from '@components/layout/page-heading';
import { ExplorerPairReport } from '@components/blockchain/explorer-pair-report';
import { explorerRouteFilters } from '../../../api/explorer-search-route';

async function Report({
	searchParams
}: {
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
	return (
		<ExplorerPairReport
			initialFilters={explorerRouteFilters(await searchParams)}
		/>
	);
}

export default function MarketsPage(props: {
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				title="Historical markets"
				eyebrow="Explorer"
				description="Investigate an asset pair across recorded trades and native pools."
			/>
			<Suspense fallback={<p role="status">Loading report…</p>}>
				<Report {...props} />
			</Suspense>
		</main>
	);
}
