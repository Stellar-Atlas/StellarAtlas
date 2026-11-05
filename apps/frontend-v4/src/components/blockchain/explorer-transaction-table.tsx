'use client';

import { useEffect, useRef, useState } from 'react';
import { ExplorerLink } from './explorer-investigation';
import type { PublicRecentTransactions } from '@api/types';
import { buildEntityHref } from '../../api/explorer-analytics';
import { withExplorerReturnTo } from '../../api/explorer-return-context';
import {
	formatDate,
	formatTransactionHash,
	writeClipboardText
} from './blockchain-explorer-format';
import styles from './explorer-transaction-table.module.css';
import { formatAtomic } from './explorer-format-values';

export function ExplorerTransactionTable({
	transactions,
	returnTo,
	jumpPrefix,
	caption = 'Latest available transaction records. Dates are shown in your local time.'
}: {
	readonly transactions: Pick<PublicRecentTransactions, 'records' | 'limit'>;
	readonly returnTo?: string;
	readonly jumpPrefix?: string;
	readonly caption?: string;
}): React.JSX.Element {
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
			<table className={styles.table} role="table">
				<caption>{caption}</caption>
				<thead role="rowgroup">
					<tr role="row">
						{[
							'Transaction',
							'Result',
							'Closed',
							'Ledger',
							'Operations',
							'Fee (XLM)',
							'Source account'
						].map((label) => (
							<th key={label} scope="col" role="columnheader">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody role="rowgroup">
					{transactions.records.slice(0, transactions.limit).map((tx) => {
						const href = buildEntityHref('transactions', tx.hash, { ledger_sequence: tx.ledger });
						const displayHash = formatTransactionHash(tx.hash);
						const label = 'Open transaction ' + tx.hash;
						const jumpId = jumpPrefix ? jumpPrefix + '-' + tx.hash : undefined;
						const hashText = <>
							<span className={styles.wideHash}>{displayHash}</span>
							<span className={styles.compactHash}>{tx.hash.length > 16 ? tx.hash.slice(0, 7) + '…' + tx.hash.slice(-6) : tx.hash}</span>
						</>;
						const displayAccount = tx.sourceAccount.slice(0, 6) + '…' + tx.sourceAccount.slice(-5);
						return (
							<tr key={tx.hash} role="row">
								<td data-label="Transaction" role="cell">
									<div className={styles.hash}>
										{returnTo ? (
											<a id={jumpId} className={styles.identifier} aria-label={label} title={tx.hash} href={withExplorerReturnTo(href, returnTo)}>{hashText}</a>
										) : (
											<ExplorerLink id={jumpId} className={styles.identifier} aria-label={label} title={tx.hash} href={href}>{hashText}</ExplorerLink>
										)}
										<details className={styles.identifiers}>
											<summary aria-label={'IDs for ' + displayHash}>IDs</summary>
											<div className={styles.fullHash}>
												<span>Transaction hash</span>
												<code>{tx.hash}</code>
												<span>Source account</span>
												<code>{tx.sourceAccount}</code>
												<button type="button" onClick={() => void copyHash(tx.hash)}>Copy hash</button>
												<span role="status">{copiedHash === tx.hash ? 'Copied' : ''}</span>
											</div>
										</details>
									</div>
								</td>
								<td data-label="Result" role="cell">
									<span className={tx.successful ? styles.success : styles.failed}>
										{tx.successful ? 'Successful' : 'Failed'}
									</span>
								</td>
								<td data-label="Closed" role="cell">
									<time dateTime={tx.createdAt}>{formatDate(tx.createdAt)}</time>
								</td>
								<td data-label="Ledger" role="cell">
									<ExplorerLink href={buildEntityHref('ledgers', tx.ledger)}>
										{tx.ledger}
									</ExplorerLink>
								</td>
								<td data-label="Operations" role="cell" className={styles.numeric}>
									{tx.operationCount}
								</td>
								<td data-label="Fee (XLM)" role="cell" className={styles.numeric}>
									<div className={styles.fee}>{/^\d+$/.test(tx.feeCharged) ? <>
										<span>{formatAtomic(tx.feeCharged, 7)}</span>
										<small>{tx.feeCharged} stroops</small>
									</> : '—'}</div>
								</td>
								<td data-label="Source account" role="cell">
									<ExplorerLink
										className={styles.identifier}
										href={buildEntityHref('accounts', tx.sourceAccount)}
										aria-label={'Source account ' + tx.sourceAccount}
										title={tx.sourceAccount}
									>
										{displayAccount}
									</ExplorerLink>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
