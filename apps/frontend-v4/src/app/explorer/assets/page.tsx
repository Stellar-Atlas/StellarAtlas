import { PageHeading } from '@components/layout/page-heading';
import { ExplorerAssetWorkspace } from '@components/blockchain/explorer-asset-workspace';

export default async function ExplorerAssetsPage({ searchParams }: PageProps<'/explorer/assets'>): Promise<React.JSX.Element> {
	const params = await searchParams;
	const initialFilters = Object.fromEntries(Object.entries(params).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []));
	return (
		<main className="shell">
			<PageHeading title="Assets" eyebrow="Explorer" description="Search assets by code, issuer address, contract address, and observed range." />
			<ExplorerAssetWorkspace initialFilters={initialFilters} />
		</main>
	);
}
