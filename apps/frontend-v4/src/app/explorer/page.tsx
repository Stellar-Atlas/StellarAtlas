import { PageHeading } from '@components/layout/page-heading';
import { BlockchainGraphPrototype } from '@components/blockchain/blockchain-graph-prototype';
import { TransactionHashLookup } from '@components/blockchain/transaction-hash-lookup';

export default function ExplorerPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Latest ledger transaction and source-account graph prototype for the full-history explorer."
				eyebrow="Graph Explorer"
				title="Explorer"
			/>
			<TransactionHashLookup />
			<BlockchainGraphPrototype />
		</main>
	);
}
