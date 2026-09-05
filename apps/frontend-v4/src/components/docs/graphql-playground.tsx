'use client';

import { useEffect, useRef, useState } from 'react';
import {
	graphqlExamples,
	graphqlPageVariables,
	isRecord,
	parseGraphqlVariables
} from './graphql-request';
import styles from './graphql-playground.module.css';

export function GraphqlPlayground(): React.JSX.Element {
	const [query, setQuery] = useState<string>(graphqlExamples.ledgers.query);
	const [variables, setVariables] = useState(
		JSON.stringify(graphqlExamples.ledgers.variables, null, 2)
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
	const controller = useRef<AbortController | null>(null);

	useEffect(() => () => controller.current?.abort(), []);

	async function run(nextVariables = variables): Promise<void> {
		if (controller.current) return;
		const abort = new AbortController();
		controller.current = abort;
		const timeout = setTimeout(() => abort.abort(), 20_000);
		setBusy(true);
		setPages({ previous: null, next: null });
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
				setPages({
					previous: graphqlPageVariables(nextVariables, decoded, -1),
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
		setResponse('');
		setStatus('Example loaded. Select Run query to send it.');
	}

	function page(nextVariables: string | null): void {
		if (nextVariables === null) return;
		setVariables(nextVariables);
		void run(nextVariables);
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
					defaultValue="ledgers"
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
					onClick={() => page(pages.previous)}
				>
					Previous page
				</button>
				<button
					disabled={busy || pages.next === null}
					onClick={() => page(pages.next)}
				>
					Next page
				</button>
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
				Pagination uses the returned limit and offset. A full page permits a
				next request, not a guarantee of another row. Change the example’s
				ledger filters to query another range.
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
