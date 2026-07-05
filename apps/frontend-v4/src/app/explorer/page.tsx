import { PageHeading } from '@components/layout/page-heading';
import { BlockchainExplorer } from '@components/blockchain/blockchain-explorer';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Search ledgers, transactions, addresses, operations, assets, and contract status."
				eyebrow="Blockchain Explorer"
				title="Explorer"
			/>
			<BlockchainExplorer />
		</main>
	);
}
