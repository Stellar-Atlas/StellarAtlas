'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { recordValue, requestExplorerJson } from '../../api/explorer-analytics';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

type Issuer = { id: string; homeDomain: string | null; assetCount: number };
type Page = {
	rows: readonly Issuer[];
	next: string | null;
	domainsReady: boolean;
};
function parse(value: unknown): Page {
	const data = recordValue(value);
	if (!Array.isArray(data.data) || data.data.length > 100)
		throw new Error('Invalid issuer response.');
	return {
		rows: data.data.map((value) => {
			const row = recordValue(value);
			if (
				typeof row.id !== 'string' ||
				!/^G[A-Z2-7]{55}$/.test(row.id) ||
				typeof row.assetCount !== 'number' ||
				!Number.isSafeInteger(row.assetCount)
			)
				throw new Error('Invalid issuer row.');
			return {
				id: row.id,
				homeDomain: typeof row.homeDomain === 'string' ? row.homeDomain : null,
				assetCount: row.assetCount
			};
		}),
		next: typeof data.nextCursor === 'string' ? data.nextCursor : null,
		domainsReady: data.domainsReady === true
	};
}
export function ExplorerIssuerDirectory(): React.JSX.Element {
	const [query, setQuery] = useState('');
	const [selection, setSelection] = useState({
		q: '',
		cursor: null as string | null,
		revision: 0
	});
	const [page, setPage] = useState<Page | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const abort = new AbortController();
		const params = new URLSearchParams({ q: selection.q, limit: '25' });
		if (selection.cursor) params.set('cursor', selection.cursor);
		setBusy(true);
		setError(null);
		void requestExplorerJson('/v1/issuers?' + params, abort.signal)
			.then((value) => {
				if (abort.signal.aborted) return;
				const next = parse(value);
				setPage((current) =>
					selection.cursor && current
						? { ...next, rows: [...current.rows, ...next.rows] }
						: next
				);
			})
			.catch((cause) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Issuer search failed.'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [selection]);
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="issuers" />
			<section className={styles.panel}>
				<form
					className={ui.search}
					onSubmit={(event) => {
						event.preventDefault();
						setSelection((current) => ({
							q: query.trim(),
							cursor: null,
							revision: current.revision + 1
						}));
					}}
				>
					<input
						aria-label="Search issuers"
						placeholder="Issuer G-address or home domain"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
					<button type="submit" disabled={busy}>
						{busy ? 'Searching…' : 'Search issuers'}
					</button>
				</form>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{page && (
					<>
						<div className={styles.tableWrap}>
							<table className={styles.table}>
								<thead>
									<tr>
										<th>Home domain</th>
										<th>Issuer</th>
										<th className={ui.numeric}>Indexed assets</th>
									</tr>
								</thead>
								<tbody>
									{page.rows.map((row) => (
										<tr key={row.id}>
											<td>
												<Link href={'/explorer/issuers/' + row.id}>
													{row.homeDomain || 'Not published / not indexed'}
												</Link>
											</td>
											<td>
												<Link
													className={ui.plainHash}
													href={'/explorer/issuers/' + row.id}
												>
													{row.id}
												</Link>
											</td>
											<td className={ui.numeric}>
												<Link href={'/explorer/issuers/' + row.id}>
													{row.assetCount.toLocaleString()}
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{!page.rows.length && (
							<p className={styles.muted}>No matching indexed issuers.</p>
						)}
						<div className={styles.actions}>
							<button
								disabled={busy || !page.next}
								onClick={() =>
									setSelection((current) => ({ ...current, cursor: page.next }))
								}
							>
								Load more
							</button>
							{!page.domainsReady && (
								<span className={ui.observationLabel}>
									Cached home domains are loading.
								</span>
							)}
						</div>
					</>
				)}
			</section>
		</div>
	);
}
