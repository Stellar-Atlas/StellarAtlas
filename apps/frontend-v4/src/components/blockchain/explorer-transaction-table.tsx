'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicRecentTransactions } from '@api/types';
import { buildEntityHref } from '../../api/explorer-analytics';
import {
	formatDate,
	formatTransactionHash,
	writeClipboardText
} from './blockchain-explorer-format';
import styles from './explorer-transaction-table.module.css';

export function ExplorerTransactionTable({
	transactions,
	onInspect
}: {
	readonly transactions: PublicRecentTransactions;
	readonly onInspect: (hash: string, ledger: string) => void;
}): React.JSX.Element {
	const [expandedHash, setExpandedHash] = useState<string | null>(null);
	const [copiedHash, setCopiedHash] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current);
		},
		[]
	);
	const copyHash = async (hash: string): Promise<void> => {
		try {
			await writeClipboardText(hash);
			setCopiedHash(hash);
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				setCopiedHash(null);
				timer.current = null;
			}, 1600);
		} catch {
			setCopiedHash(null);
		}
	};
	if (!transactions.records.length)
		return <p className="explorer-state neutral">No transactions returned.</p>;
	return (
		<div
			className={styles.container}
			role="region"
			aria-label="Transaction records"
			tabIndex={0}
		>
			<table className={styles.table}>
				<caption>
					Latest available transaction records. Dates are shown in your local
					time.
				</caption>
				<thead>
					<tr>
						{[
							'Transaction',
							'Source account',
							'Closed',
							'Ledger',
							'Operations',
							'Fee (stroops)',
							'Result',
							'Details'
						].map((label) => (
							<th key={label} scope="col">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{transactions.records.slice(0, transactions.limit).map((tx) => (
						<tr key={tx.hash}>
							<td data-label="Transaction">
								<div className={styles.hash}>
									<a
										className={styles.identifier}
										title={tx.hash}
										href={buildEntityHref('transactions', tx.hash, {
											ledger_sequence: tx.ledger
										})}
									>
										{formatTransactionHash(tx.hash)}
									</a>
									<div className={styles.actions}>
										<button
											type="button"
											onClick={() => void copyHash(tx.hash)}
											aria-label={'Copy transaction hash ' + tx.hash}
										>
											{copiedHash === tx.hash ? 'Copied' : 'Copy'}
										</button>
										<button
											type="button"
											aria-label={
												(expandedHash === tx.hash ? 'Collapse' : 'Expand') +
												' transaction hash ' +
												tx.hash
											}
											aria-expanded={expandedHash === tx.hash}
											aria-controls={'transaction-hash-' + tx.hash}
											onClick={() =>
												setExpandedHash(
													expandedHash === tx.hash ? null : tx.hash
												)
											}
										>
											{expandedHash === tx.hash ? 'Hide' : 'Full'}
										</button>
									</div>
									{expandedHash === tx.hash && (
										<code
											className={styles.fullHash}
											id={'transaction-hash-' + tx.hash}
										>
											{tx.hash}
										</code>
									)}
								</div>
							</td>
							<td data-label="Source account">
								<a
									className={styles.identifier}
									href={buildEntityHref('accounts', tx.sourceAccount)}
									title={tx.sourceAccount}
								>
									{formatTransactionHash(tx.sourceAccount)}
								</a>
							</td>
							<td data-label="Closed">
								<time dateTime={tx.createdAt}>{formatDate(tx.createdAt)}</time>
							</td>
							<td data-label="Ledger">
								<a href={buildEntityHref('ledgers', tx.ledger)}>{tx.ledger}</a>
							</td>
							<td data-label="Operations" className={styles.numeric}>
								{tx.operationCount}
							</td>
							<td data-label="Fee (stroops)" className={styles.numeric}>
								{tx.feeCharged}
							</td>
							<td data-label="Result">
								<span
									className={tx.successful ? styles.success : styles.failed}
								>
									{tx.successful ? 'Successful' : 'Failed'}
								</span>
							</td>
							<td data-label="Details">
								<button
									className={styles.inspect}
									type="button"
									onClick={() => onInspect(tx.hash, tx.ledger)}
									aria-label={'Inspect transaction ' + tx.hash}
								>
									Inspect
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
