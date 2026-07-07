import { PageHeading } from '@components/layout/page-heading';
import { BlockchainExplorer } from '@components/blockchain/blockchain-explorer';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Inspect local parsed ledger-header coverage and bounded external lookup results while full decoded indexes are being built."
				eyebrow="Blockchain Explorer"
				title="Explorer"
			/>
			<BlockchainExplorer />
		</main>
	);
}
