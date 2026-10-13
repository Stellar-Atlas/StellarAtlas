'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from '../../api/explorer-analytics';
import styles from './explorer-entity.module.css';

export function ExplorerSimilarAssets({
	asset
}: {
	readonly asset: string;
}): React.JSX.Element {
	const [rows, setRows] = useState<readonly EntityRecord[]>([]),
		[error, setError] = useState<string | null>(null),
		[next, setNext] = useState<string | null>(null),
		[cursor, setCursor] = useState(''),
		[history, setHistory] = useState<string[]>([]);
	useEffect(() => {
		const abort = new AbortController();
		setError(null);
		void requestExplorerJson(
			'/v1/assets/' +
				encodeURIComponent(asset) +
				'/similar?' +
				new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) }),
			abort.signal
		)
			.then((raw) => {
				if (abort.signal.aborted) return;
				const result = recordValue(raw);
				if (!Array.isArray(result.data) || result.data.length > 25)
					throw new Error('Invalid asset page');
				setRows(result.data.map(recordValue));
				setNext(
					typeof result.nextCursor === 'string' ? result.nextCursor : null
				);
			})
			.catch((cause: unknown) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Assets unavailable'
					);
			});
		return () => abort.abort();
	}, [asset, cursor]);
	return (
		<section className={styles.panel}>
			<h3>Other assets with the same symbol</h3>
			<p className={styles.muted}>
				Compare issuers. A matching symbol does not establish authenticity.
			</p>
			{error && <p role="alert">{error}</p>}
			<div className={styles.tableWrap}>
				<table className={styles.table}>
					<thead>
						<tr>
							<th>Asset</th>
							<th>Issuer</th>
							<th>Identity source</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={entityText(row, 'id')}>
								<td>
									<Link
										href={
											'/explorer/assets/' +
											encodeURIComponent(entityText(row, 'id'))
										}
									>
										{entityText(row, 'code')}
									</Link>
								</td>
								<td>
									<Link
										className={styles.hash}
										href={'/explorer/issuers/' + entityText(row, 'issuer')}
									>
										{entityText(row, 'issuer')}
									</Link>
								</td>
								<td>
									{entityText(row, 'source') ? (
										<a
											href={entityText(row, 'source')}
											target="_blank"
											rel="noreferrer"
										>
											Project reference
										</a>
									) : (
										'—'
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className={styles.actions}>
				<button
					disabled={!history.length}
					onClick={() => {
						setCursor(history.at(-1) || '');
						setHistory((current) => current.slice(0, -1));
					}}
				>
					Previous
				</button>
				<button
					disabled={!next}
					onClick={() => {
						setHistory((current) => [...current, cursor]);
						setCursor(next || '');
					}}
				>
					Next
				</button>
			</div>
		</section>
	);
}
