'use client';

import type { PublicRecentTransactions } from '@api/types';
import { ExplorerTransactionTable } from './explorer-transaction-table';
import { transactionPageResultQuery, type TransactionPageResult } from './transaction-page-result';
import styles from './explorer-transaction-table.module.css';

const resultLabels = { all: 'All', successful: 'Successful', failed: 'Failed' } as const;

/** Filters only the already loaded, bounded page. Does not affect paging or issue a query. */
export function ExplorerTransactionPageResults({ transactions, result, caption, returnTo }: {
	readonly transactions: Pick<PublicRecentTransactions, 'records' | 'limit'>;
	readonly result: TransactionPageResult;
	readonly caption: string;
	readonly returnTo?: string;
}): React.JSX.Element {
	const loaded = transactions.records.slice(0, transactions.limit);
	const successful = loaded.filter(row => row.successful).length;
	const counts = { all: loaded.length, successful, failed: loaded.length - successful };
	const records = result === 'all' ? loaded : loaded.filter(row => row.successful === (result === 'successful'));
	const navigate = (next: TransactionPageResult) => {
		const { pathname, search, hash } = window.location;
		const query = transactionPageResultQuery(search, next);
		if (search !== query) window.history.pushState(null, '', pathname + query + hash);
	};
	return (
		<div className={styles.pageResults}>
			<div className={styles.resultFilters} role="group" aria-label="Result on this page">
				<span>Result on this page</span>
				{(['all', 'successful', 'failed'] as const).map(value => (
					<button key={value} type="button" aria-pressed={value === result} onClick={() => navigate(value)}>
						{resultLabels[value]} {counts[value]}
					</button>
				))}
			</div>
			{records.length > 0
				? <ExplorerTransactionTable transactions={{ records, limit: transactions.limit }} caption={caption} returnTo={returnTo} />
				: <p className="explorer-state neutral" role="status">No {result === 'all' ? '' : result + ' '}transactions on this page.</p>}
		</div>
	);
}
