import { PageHeading } from '@components/layout/page-heading';
import { BlockchainExplorer } from '@components/blockchain/blockchain-explorer';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Explore Stellar transactions, accounts, assets, contracts, operations, trades and offers."
				eyebrow="Blockchain Explorer"
				title="Explorer"
			/>
			<BlockchainExplorer />
		</main>
	);
}
