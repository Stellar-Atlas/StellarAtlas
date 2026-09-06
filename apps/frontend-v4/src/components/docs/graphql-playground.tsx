'use client';

import { useEffect, useRef, useState } from 'react';
import {
	graphqlExamples,
	graphqlPageVariables,
	isRecord,
	parseGraphqlVariables
} from './graphql-request';
import {
	transactionPageVariables,
	transactionRelations,
	type TransactionRelation
} from './graphql-transaction-request';
import styles from './graphql-playground.module.css';

export function GraphqlPlayground(): React.JSX.Element {
	const [query, setQuery] = useState<string>(graphqlExamples.transfers.query);
	const [variables, setVariables] = useState(
		JSON.stringify(graphqlExamples.transfers.variables, null, 2)
	);
	const [status, setStatus] = useState(
		'No request sent. Queries run only when you select Run query.'
	);
	const [response, setResponse] = useState('');
	const [busy, setBusy] = useState(false);
	const [pages, setPages] = useState<{
		previous: string | null;
		next: string | null;
	}>({ previous: null, next: null });
	const [transactionPages, setTransactionPages] = useState<
		Partial<Record<TransactionRelation, string | null>>
	>({});
	const controller = useRef<AbortController | null>(null);
	const navigationHistory = useRef<string[]>([]);
	const lastSuccessfulVariables = useRef<string | null>(null);

	useEffect(() => () => controller.current?.abort(), []);

	async function run(
		nextVariables = variables,
		direction: 'reset' | 'next' | 'previous' = 'reset'
	): Promise<void> {
		if (controller.current) return;
		const abort = new AbortController();
		controller.current = abort;
		const timeout = setTimeout(() => abort.abort(), 20_000);
		setBusy(true);
		setPages({ previous: null, next: null });
		setTransactionPages({});
		setStatus('Sending POST /graphql…');
		setResponse('');
		const started = performance.now();
		try {
			const parsed = parseGraphqlVariables(nextVariables);
			const result = await fetch('/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/graphql-response+json, application/json'
				},
				credentials: 'omit',
				signal: abort.signal,
				body: JSON.stringify({ query, variables: parsed })
			});
			const body = await result.text();
			let decoded: unknown;
			try {
				decoded = JSON.parse(body);
			} catch {
				decoded = null;
			}
			const queryErrors =
				isRecord(decoded) &&
				Array.isArray(decoded.errors) &&
				decoded.errors.length > 0;
			setResponse(decoded === null ? body : JSON.stringify(decoded, null, 2));
			setStatus(
				`HTTP ${result.status} · ${Math.round(performance.now() - started)} ms${queryErrors ? ' · GraphQL errors returned (see response)' : ''}`
			);
			if (result.ok && !queryErrors) {
				if (direction === 'reset') navigationHistory.current = [];
				else if (
					direction === 'next' &&
					lastSuccessfulVariables.current !== null
				)
					navigationHistory.current.push(lastSuccessfulVariables.current);
				else if (direction === 'previous') navigationHistory.current.pop();
				lastSuccessfulVariables.current = nextVariables;
				setTransactionPages(
					Object.fromEntries(
						transactionRelations.map((relation) => [
							relation,
							transactionPageVariables(nextVariables, decoded, relation)
						])
					)
				);
				setPages({
					previous: navigationHistory.current.at(-1) ?? null,
					next: graphqlPageVariables(nextVariables, decoded, 1)
				});
			}
		} catch (error) {
			setStatus(
				abort.signal.aborted
					? 'Request canceled or exceeded the 20-second browser timeout.'
					: error instanceof Error
						? error.message
						: 'Request failed.'
			);
		} finally {
			clearTimeout(timeout);
			controller.current = null;
			setBusy(false);
		}
	}

	function changeExample(key: keyof typeof graphqlExamples): void {
		setQuery(graphqlExamples[key].query);
		setVariables(JSON.stringify(graphqlExamples[key].variables, null, 2));
		setPages({ previous: null, next: null });
		setTransactionPages({});
		setResponse('');
		setStatus('Example loaded. Select Run query to send it.');
	}

	function page(
		nextVariables: string | null,
		direction: 'next' | 'previous'
	): void {
		if (nextVariables === null) return;
		setVariables(nextVariables);
		void run(nextVariables, direction);
	}

	return (
		<section
			className={styles.playground}
			id="graphql"
			aria-labelledby="graphql-heading"
		>
			<div>
				<h2 id="graphql-heading">Try GraphQL</h2>
				<p>
					Read-only <code>POST /graphql</code>. Edit the query and JSON
					variables, then inspect the actual HTTP status and response. No
					credentials are requested.
				</p>
			</div>
			<label>
				Example
				<select
					disabled={busy}
					defaultValue="transfers"
					onChange={(event) =>
						changeExample(event.target.value as keyof typeof graphqlExamples)
					}
				>
					{Object.entries(graphqlExamples).map(([key, example]) => (
						<option key={key} value={key}>
							{example.label}
						</option>
					))}
				</select>
			</label>
			<div className={styles.editors}>
				<label>
					GraphQL query
					<textarea
						rows={13}
						spellCheck={false}
						value={query}
						disabled={busy}
						onChange={(event) => {
							setQuery(event.target.value);
							setPages({ previous: null, next: null });
							setTransactionPages({});
						}}
					/>
				</label>
				<label>
					Variables (JSON)
					<textarea
						rows={13}
						spellCheck={false}
						value={variables}
						disabled={busy}
						onChange={(event) => {
							setVariables(event.target.value);
							setPages({ previous: null, next: null });
							setTransactionPages({});
						}}
					/>
				</label>
			</div>
			<div className={styles.actions}>
				<button
					className="primary-button"
					disabled={busy}
					onClick={() => void run()}
				>
					Run query
				</button>
				{busy && (
					<button onClick={() => controller.current?.abort()}>Cancel</button>
				)}
				<button
					disabled={busy || pages.previous === null}
					onClick={() => page(pages.previous, 'previous')}
				>
					Previous page
				</button>
				<button
					disabled={busy || pages.next === null}
					onClick={() => page(pages.next, 'next')}
				>
					Next page
				</button>
				{transactionRelations.map((relation) =>
					transactionPages[relation] ? (
						<button
							key={relation}
							disabled={busy}
							onClick={() => page(transactionPages[relation] ?? null, 'next')}
						>
							Next {relation}
						</button>
					) : null
				)}
			</div>
			<p role="status" aria-live="polite">
				{status}
			</p>
			{response && (
				<pre
					className={styles.response}
					tabIndex={0}
					aria-label="GraphQL response"
				>
					{response}
				</pre>
			)}
			<p>
				Transaction operations, effects, and events have independent page
				buttons. The optional ledgerSequence hint speeds up transaction lookup;
				the hash remains the identifier. Typed transfer queries use the returned
				nextCursor; Previous page reuses the previous request. Generic dataset
				queries retain offset pagination. Ledger bounds describe the requested
				window, not a frozen database snapshot or a guarantee that ingestion has
				filled every gap.
			</p>
			<p>
				Coverage is partial while ingestion catches up. Minimum and maximum
				ledger values are bounds, not proof that every intervening ledger is
				present. Empty results do not establish that an account, transaction, or
				contract never existed.
			</p>
		</section>
	);
}
