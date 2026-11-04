import type { PublicRecentTransactions } from '@api/types';
import { formatDate } from './blockchain-explorer-format';
import styles from './explorer-transaction-table.module.css';

export function ExplorerTransactionFeedStatus({
	transactions
}: {
	readonly transactions: PublicRecentTransactions;
}): React.JSX.Element {
	const tone = transactions.freshness === 'fresh' ? 'neutral' : 'warning';
	const count = Math.min(transactions.records.length, transactions.limit);
	const source = transactions.source === 'local_history' ? 'StellarAtlas historical records' : 'Stellar public API';
	return (
		<p className={`explorer-state ${tone} ${styles.feedStatus}`} role="status">
			<strong>
				{count === 0 ? 'No transactions returned' : `${count} recent transaction${count === 1 ? '' : 's'} loaded`}
			</strong>
			{' · Source: '}{source}{' · '}{formatTransactionStatus(transactions)}
		</p>
	);
}

function formatTransactionStatus(
	transactions: PublicRecentTransactions
): string {
	if (transactions.freshness === 'fresh' && transactions.dataThrough !== null) {
		return `Data through ${formatDate(transactions.dataThrough)}`;
	}
	if (transactions.freshness === 'stale') {
		return transactions.dataThrough === null
			? 'Transaction updates are delayed.'
			: `Transaction updates are delayed. Data through ${formatDate(transactions.dataThrough)}.`;
	}
	return 'Transaction updates are temporarily unavailable.';
}
