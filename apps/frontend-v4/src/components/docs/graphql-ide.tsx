'use client';

import 'graphiql/setup-workers/webpack';
import 'graphiql/style.css';
import { GraphiQL } from 'graphiql';
import { useEffect, useRef, useState } from 'react';
import { graphqlExamples, graphqlPageVariables } from './graphql-request';
import {
	createGraphqlIdeTransport,
	type GraphqlIdeResult
} from './graphql-ide-fetcher';
import {
	transactionPageVariables,
	transactionRelations,
	type TransactionRelation
} from './graphql-transaction-request';
import styles from './graphql-ide.module.css';

type ExampleKey = keyof typeof graphqlExamples;
interface EditorDraft {
	query: string;
	variables: string;
	revision: number;
}
interface PageLink {
	query: string;
	variables: string;
}

export default function GraphqlIde(): React.JSX.Element {
	const initial = graphqlExamples.transfers;
	const [draft, setDraft] = useState<EditorDraft>({
		query: initial.query,
		variables: JSON.stringify(initial.variables, null, 2),
		revision: 0
	});
	const [example, setExample] = useState<ExampleKey>('transfers');
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState(
		'Loading the API schema. Data queries run only when you press Execute (▶).'
	);
	const [next, setNext] = useState<PageLink | null>(null);
	const [previous, setPrevious] = useState<PageLink | null>(null);
	const [related, setRelated] = useState<
		Partial<Record<TransactionRelation, PageLink>>
	>({});
	const editor = useRef<PageLink>(draft);
	const history = useRef<PageLink[]>([]);
	const lastResult = useRef<PageLink | null>(null);
	const navigation = useRef<'next' | 'previous' | null>(null);
	const mounted = useRef(true);
	const receive = useRef((result: GraphqlIdeResult): void => {
		if (!mounted.current) return;
		const errors = result.result.errors?.length;
		if (result.schemaRequest) {
			setStatus(
				errors
					? 'Schema request returned errors; see the schema explorer.'
					: 'Schema loaded. Choose an example or use autocomplete, then press Execute (▶).'
			);
			return;
		}
		setStatus(
			'HTTP ' +
				result.status +
				' · ' +
				result.elapsedMilliseconds +
				' ms' +
				(errors ? ' · GraphQL errors returned (see response)' : '')
		);
		setNext(null);
		setRelated({});
		if (result.status < 200 || result.status >= 300 || errors) return;
		const current = { query: result.query, variables: result.variables };
		if (navigation.current === 'previous') history.current.pop();
		else if (navigation.current === 'next' && lastResult.current)
			history.current.push(lastResult.current);
		else history.current = [];
		navigation.current = null;
		lastResult.current = current;
		setPrevious(history.current.at(-1) ?? null);
		const nextVariables = graphqlPageVariables(
			result.variables,
			result.result,
			1
		);
		setNext(
			nextVariables ? { query: result.query, variables: nextVariables } : null
		);
		setRelated(
			Object.fromEntries(
				transactionRelations.flatMap((relation) => {
					const variables = transactionPageVariables(
						result.variables,
						result.result,
						relation
					);
					return variables
						? [[relation, { query: result.query, variables }]]
						: [];
				})
			)
		);
	});
	const [transport] = useState(() =>
		createGraphqlIdeTransport({
			onBusy: (value) => {
				if (mounted.current) setBusy(value);
			},
			onResult: (result) => receive.current(result),
			onError: (message, schema) => {
				if (mounted.current)
					setStatus((schema ? 'Schema unavailable: ' : '') + message);
			}
		})
	);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			transport.dispose();
		};
	}, [transport]);

	function load(link: PageLink, direction: 'next' | 'previous' | null): void {
		editor.current = link;
		navigation.current = direction;
		setDraft((old) => ({ ...link, revision: old.revision + 1 }));
		setNext(null);
		setPrevious(null);
		setRelated({});
		setStatus(
			'Loaded in the editor. Press Execute (▶) to send the query; no data request was sent.'
		);
	}
	function choose(key: ExampleKey): void {
		const selected = graphqlExamples[key];
		setExample(key);
		history.current = [];
		lastResult.current = null;
		load(
			{
				query: selected.query,
				variables: JSON.stringify(selected.variables, null, 2)
			},
			null
		);
	}
	function edit(field: 'query' | 'variables', value: string): void {
		if (editor.current[field] === value) return;
		editor.current = { ...editor.current, [field]: value };
		// Never apply an old response's cursor to a newly edited query.
		setNext(null);
		setPrevious(null);
		setRelated({});
		navigation.current = null;
	}

	return (
		<section
			className={styles.playground}
			id="graphql"
			aria-labelledby="graphql-heading"
		>
			<header>
				<h2 id="graphql-heading">GraphQL explorer</h2>
				<p>
					Browse the live schema, complete fields as you type, and inspect real
					responses from <code>POST /graphql</code>. Schema discovery is
					automatic; data queries run only on Execute. No credentials are
					requested or sent.
				</p>
			</header>
			<label className={styles.example}>
				Example
				<select
					value={example}
					disabled={busy}
					onChange={(event) => choose(event.target.value as ExampleKey)}
				>
					{Object.entries(graphqlExamples).map(([key, item]) => (
						<option key={key} value={key}>
							{item.label}
						</option>
					))}
				</select>
			</label>
			<p role="status" aria-live="polite" className={styles.status}>
				{status}
			</p>
			<div className={styles.ide}>
				<GraphiQL
					key={draft.revision}
					fetcher={transport.fetcher}
					initialQuery={draft.query}
					initialVariables={draft.variables}
					onEditQuery={(value) => edit('query', value)}
					onEditVariables={(value) => edit('variables', value)}
					defaultEditorToolsVisibility="variables"
					isHeadersEditorEnabled={false}
					shouldPersistHeaders={false}
					showPersistHeadersSettings={false}
					customScalarSchemas={{
						JSON: {},
						HubbleParsedNumber: { type: ['string', 'number'] }
					}}
				>
					<GraphiQL.Logo>StellarAtlas</GraphiQL.Logo>
				</GraphiQL>
			</div>
			<div className={styles.actions} aria-label="Response pagination">
				<button
					disabled={busy || !previous}
					onClick={() => previous && load(previous, 'previous')}
				>
					Load previous page
				</button>
				<button
					disabled={busy || !next}
					onClick={() => next && load(next, 'next')}
				>
					Load next page
				</button>
				{transactionRelations.map((relation) =>
					related[relation] ? (
						<button
							key={relation}
							disabled={busy}
							onClick={() => {
								const link = related[relation];
								if (link) load(link, 'next');
							}}
						>
							Load next {relation}
						</button>
					) : null
				)}
			</div>
			<p className={styles.note}>
				Page buttons load returned cursors or offsets into Variables; press
				Execute to fetch that page. Transaction operations, effects and events
				have separate cursors. Examples are representative historical windows,
				not a guarantee of complete coverage.
			</p>
			<p className={styles.note}>
				Check the response's coverage and watermark. Empty results do not
				establish that an account, transaction or contract never existed.
				Balances are latest-ingested Float64 observations, not an atomic current
				or historical as-of snapshot.
			</p>
		</section>
	);
}
