import { PageHeading } from '@components/layout/page-heading';
import { BlockchainExplorer } from '@components/blockchain/blockchain-explorer';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Search bounded Horizon-backed ledger, transaction, address, operation, and asset data while local full-history read models are still being built."
				eyebrow="Blockchain Explorer"
				title="Explorer"
			/>
			<BlockchainExplorer />
		</main>
	);
}
