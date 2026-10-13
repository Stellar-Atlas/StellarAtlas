import { PageHeading } from '@components/layout/page-heading';
import { ExplorerAssetWorkspace } from '@components/blockchain/explorer-asset-workspace';

export default async function ExplorerAssetPage({
	params,
	searchParams
}: PageProps<'/explorer/assets/[assetRef]'>): Promise<React.JSX.Element> {
	const [{ assetRef }, query] = await Promise.all([params, searchParams]);
	const initialFilters = Object.fromEntries(
		Object.entries(query).flatMap(([key, value]) =>
			typeof value === 'string' ? [[key, value]] : []
		)
	);
	return (
		<main className="shell">
			<PageHeading title="Asset details" eyebrow="Explorer" />
			<ExplorerAssetWorkspace
				assetRef={assetRef}
				initialFilters={initialFilters}
			/>
		</main>
	);
}
