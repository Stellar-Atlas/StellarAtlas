import { PageHeading } from '@components/layout/page-heading';
import { ExplorerAssetWorkspace } from '@components/blockchain/explorer-asset-workspace';

export default async function ExplorerIssuerPage({ params }: PageProps<'/explorer/issuers/[issuerId]'>): Promise<React.JSX.Element> {
	const { issuerId } = await params;
	return (
		<main className="shell">
			<PageHeading title="Issuer details" eyebrow="Explorer" description="Inspect issuer metadata and its published assets." />
			<ExplorerAssetWorkspace issuerId={issuerId} />
		</main>
	);
}
