'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { DocsOperation } from './docs-operation-model';
import styles from './docs-api-directory.module.css';

export function DocsApiDirectory({
	operations
}: {
	operations: readonly DocsOperation[];
}) {
	const [query, setQuery] = useState('');
	const groups = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase('en');
		const result = new Map<string, DocsOperation[]>();
		for (const operation of operations) {
			if (
				needle &&
				![
					operation.title,
					operation.path,
					operation.group,
					operation.method
				].some((value) => value.toLocaleLowerCase('en').includes(needle))
			)
				continue;
			const rows = result.get(operation.group) ?? [];
			rows.push(operation);
			result.set(operation.group, rows);
		}
		return [...result];
	}, [operations, query]);
	const count = groups.reduce((total, [, rows]) => total + rows.length, 0);
	return (
		<div className={styles.directory}>
			<label className={styles.filter}>
				Find an endpoint
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					type="search"
					placeholder="Transaction, balance, transfer, contract…"
				/>
			</label>
			<p className={styles.count} role="status">
				{count} of {operations.length} endpoints
			</p>
			{groups.map(([name, rows]) => (
				<section key={name}>
					<h2>{name}</h2>
					<ul>
						{rows.map((operation) => (
							<li key={operation.id}>
								<Link href={operation.url} prefetch={false}>
									<span className={styles.method}>
										{operation.method.toUpperCase()}
									</span>
									<span>
										<strong>{operation.title}</strong>
										<code>{operation.path}</code>
									</span>
									<span aria-hidden="true">→</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
			{count === 0 ? <p>No endpoints match that search.</p> : null}
		</div>
	);
}
