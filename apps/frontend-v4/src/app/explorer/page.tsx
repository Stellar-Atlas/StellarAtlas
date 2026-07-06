import { PageHeading } from '@components/layout/page-heading';
import { BlockchainExplorer } from '@components/blockchain/blockchain-explorer';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Search ledger, transaction, address, asset, and contract references while StellarAtlas local transaction indexes are still being built."
				eyebrow="Blockchain Explorer"
				title="Explorer"
			/>
			<BlockchainExplorer />
		</main>
	);
}
