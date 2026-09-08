import {
	api,
	Code,
	GraphqlExample,
	type DeveloperGuidePage
} from './developer-guide-elements';

export const developerGuideReferencePages: readonly DeveloperGuidePage[] = [
	{
		slug: 'graphql-guide',
		title: 'Typed GraphQL',
		group: 'Querying data',
		description:
			'Request typed entities and relationships from the same parsed warehouse.',
		sections: [
			{
				id: 'graphql-endpoint',
				title: 'Send a GraphQL request',
				content: (
					<>
						<p>
							Send <code>POST {api}/graphql</code> with a JSON body containing{' '}
							<code>query</code> and <code>variables</code>. The{' '}
							<a href="/docs/graphql">GraphQL runner</a> provides schema
							exploration and executable examples. Start with{' '}
							<code>hubbleStatus</code> for coverage and{' '}
							<code>hubbleDatasets</code> for dataset schemas.
						</p>
						<p>
							Typed fields include <code>hubbleTransaction</code>, operations,
							assets, contracts, trades, offers, transfer activity, contract
							events, account balances and asset holders. Entity list/detail
							fields share the REST services and limits; changing interfaces
							does not change data coverage.
						</p>
					</>
				)
			},
			{
				id: 'graphql-operations',
				title: 'Read operations with typed fields',
				content: (
					<>
						<GraphqlExample example="operations" />
						<p>
							The returned <code>nextOffset</code> continues the same window.
							Operations link to their transaction by hash when the parsed
							relationship is available.
						</p>
					</>
				)
			},
			{
				id: 'graphql-events',
				title: 'Inspect event classification',
				content: (
					<>
						<GraphqlExample example="events" />
						<p>
							Keep <code>nextCursor</code> and the original event filters
							together. Topics and data are decoded JSON strings; classification
							explains the execution evidence and its provenance.
						</p>
					</>
				)
			},
			{
				id: 'graphql-balances',
				title: 'Read balance observations',
				content: (
					<>
						<GraphqlExample example="balances" />
						<p>
							<code>balanceScope</code> and <code>watermark</code> identify the
							latest-ingested interpretation. A missing raw value is not zero,
							and this response is not an arbitrary-ledger state witness.
						</p>
					</>
				)
			},
			{
				id: 'graphql-datasets',
				title: 'Use structured dataset queries for aggregation',
				content: (
					<>
						<p>
							<code>hubbleQuery</code> provides schema-driven dataset selection,
							filters and grouped metrics. Its dynamic <code>rows</code> use
							JSON because the selected dataset determines the columns; typed
							entity fields remain separate. Grouped metric functions use{' '}
							<code>COUNT</code>, <code>COUNT_DISTINCT</code>, <code>SUM</code>,{' '}
							<code>AVG</code>, <code>MIN</code> and <code>MAX</code>.
						</p>
						<p>
							Run the “Analytics: count operations by type” example in the query
							runner. Check metric precision metadata and coverage, and keep
							each request bounded rather than issuing many expensive aliases at
							once.
						</p>
					</>
				)
			}
		]
	},
	{
		slug: 'services',
		title: 'API families',
		group: 'Reference',
		description:
			'Analytics, Horizon and Stellar RPC serve different jobs and different data boundaries.',
		sections: [
			{
				id: 'analytics',
				title: 'Parsed analytics: REST and GraphQL',
				content: (
					<>
						<p>
							<code>/v1/analytics</code> and <code>/graphql</code> query parsed
							ClickHouse data with completed-batch visibility and explicit
							coverage. Use them for historical analysis, entity relationships
							and aggregation.
						</p>
						<p>
							StellarAtlas uses Stellar ETL/Hubble table schemas, but the
							catalog does not promise full Hubble feature parity or complete
							chain history. Follow the published coverage and each response’s
							semantics.
						</p>
					</>
				)
			},
			{
				id: 'horizon',
				title: 'Horizon-compatible reads',
				content: (
					<>
						<p>
							<code>GET {api}/horizon/</code> is a read-only proxy to the
							configured Horizon service. Follow its HAL links for accounts and
							other Horizon resources. State-changing methods are rejected.
						</p>
						<p>
							Horizon uses its own upstream state and pagination. It is not an
							alternate URL for the ClickHouse analytics warehouse; its
							freshness and history limits can differ.
						</p>
					</>
				)
			},
			{
				id: 'rpc',
				title: 'Stellar RPC',
				content: (
					<>
						<p>
							<code>POST {api}/rpc</code> forwards JSON-RPC to the configured
							Stellar RPC service. Check the JSON-RPC <code>result</code> or{' '}
							<code>error</code>, not just HTTP 200.
						</p>
						<Code>{`curl --fail-with-body '${api}/rpc' \\
  -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`}</Code>
						<p>
							RPC availability and retained ledger history are independent of
							analytics coverage. A catching-up RPC service can return a health
							error even while parsed analytics reads work.
						</p>
					</>
				)
			},
			{
				id: 'network-and-archives',
				title: 'Network monitoring and archive evidence',
				content: (
					<>
						<p>
							The <a href="/nodes">node</a>,{' '}
							<a href="/organizations">organization</a> and{' '}
							<a href="/archives">archive</a> views describe observed network
							state and source-file evidence. Their archive scan/proof totals do
							not measure the size or completeness of the analytics warehouse.
						</p>
						<p>
							See the{' '}
							<a href="/docs/api/getKnownNodeArchiveEvidence">
								node archive-evidence reference
							</a>{' '}
							for source findings, the{' '}
							<a href="/docs/api">endpoint directory</a> for other APIs, and{' '}
							<a href="/status">status</a> for current service telemetry.
						</p>
					</>
				)
			}
		]
	}
];
