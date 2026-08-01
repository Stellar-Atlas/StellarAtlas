import type { PublicRecentTransactions } from '@api/types';
import { formatDate } from './blockchain-explorer-format';

export function ExplorerTransactionFeedStatus({
	transactions
}: {
	readonly transactions: PublicRecentTransactions;
}): React.JSX.Element {
	const tone = transactions.freshness === 'fresh' ? 'neutral' : 'warning';
	return (
		<p className={`explorer-state ${tone}`}>
			{formatTransactionStatus(transactions)}
		</p>
	);
}

function formatTransactionStatus(
	transactions: PublicRecentTransactions
): string {
	if (transactions.freshness === 'fresh' && transactions.dataThrough !== null) {
		return `Updated ${formatDate(transactions.dataThrough)}`;
	}
	if (transactions.freshness === 'stale') {
		return transactions.dataThrough === null
			? 'Transaction updates are delayed.'
			: `Transaction updates are delayed. Last updated ${formatDate(transactions.dataThrough)}.`;
	}
	return 'Transaction updates are temporarily unavailable.';
}
