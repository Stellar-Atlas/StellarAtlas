import type { Metadata } from 'next';
import Link from 'next/link';
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle
} from 'fumadocs-ui/layouts/docs/page';

export const metadata: Metadata = {
	title: 'Developer documentation | StellarAtlas',
	description:
		'Query parsed Stellar history with REST and GraphQL. Explore endpoints, data coverage, pagination and examples.'
};
const cards = [
	[
		'Quickstart',
		'Make a bounded request and follow the results.',
		'/docs/quickstart'
	],
	[
		'REST API reference',
		'Inspect every documented operation, its parameters and response, then send a request.',
		'/docs/api'
	],
	[
		'GraphQL explorer',
		'Browse the schema, use autocomplete and execute typed queries.',
		'/docs/graphql'
	],
	[
		'Datasets and coverage',
		'Understand the parsed tables, ledger ranges and ingestion gaps.',
		'/docs/datasets'
	],
	[
		'Analytics queries',
		'Filter records, group results and paginate within a ledger window.',
		'/docs/querying'
	],
	[
		'Horizon, RPC and archive files',
		'Choose the right interface and understand its storage and coverage.',
		'/docs/services'
	]
] as const;
export default function DocsPageIndex(): React.JSX.Element {
	return (
		<DocsPage
			toc={[]}
			tableOfContent={{ enabled: false }}
			tableOfContentPopover={{ enabled: false }}
		>
			<DocsTitle>Build with Stellar history</DocsTitle>
			<DocsDescription>
				Parsed transactions, operations, balances, asset activity and contract
				events through REST and GraphQL.
			</DocsDescription>
			<DocsBody>
				<p>
					Use the resource API for common lookups or query the underlying parsed
					datasets for bounded analytics. Start with a small ledger window and
					read the coverage returned with your results.
				</p>
				<div className="developer-docs-cards">
					{cards.map(([title, description, url]) => (
						<Link
							key={url}
							href={url}
							className="developer-docs-card"
							prefetch={false}
						>
							<h2>{title}</h2>
							<p>{description}</p>
						</Link>
					))}
				</div>
				<h2 id="one-contract">One API contract, executable examples</h2>
				<p>
					The endpoint reference is generated from the same OpenAPI definitions
					as the server. GraphQL uses live schema introspection. Examples are
					editable and run only when you execute them.
				</p>
				<p>
					API shape and data availability are different: historical ingestion
					can be incomplete even when an endpoint is available.{' '}
					<Link href="/docs/datasets">Read coverage and state semantics</Link>{' '}
					before interpreting an empty response.
				</p>
			</DocsBody>
		</DocsPage>
	);
}
