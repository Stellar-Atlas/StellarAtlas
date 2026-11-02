import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';
import { graphqlAnalyticsExamples } from './graphql-analytics-examples';
import { buildEntityApiPath } from '../../api/explorer-analytics';
import { developerGuideQueryPages } from './developer-guide-query-content';
import { developerGuideReferencePages } from './developer-guide-reference-content';
import { contractEventsGuide } from './developer-guide-contract-events';
import { assetsAndIssuersGuide } from './developer-guide-assets-and-issuers';
import { liveUpdatesGuide } from './developer-guide-live-updates';
import { sdkPlanGuide } from './developer-guide-sdk-plan';
import { contractVerificationGuide } from './developer-guide-contract-verification';
export type {
	DeveloperGuidePage,
	DeveloperGuideSection
} from './developer-guide-elements';

const operationInput = graphqlAnalyticsExamples.operations.variables.input;
const operationUrl = new URL(
	buildEntityApiPath('operations', undefined, {
		min_ledger: String(operationInput.minLedger),
		max_ledger: String(operationInput.maxLedger),
		type: operationInput.type,
		limit: String(operationInput.limit)
	}),
	api
);
operationUrl.searchParams.delete('offset');

export const developerGuidePages: readonly DeveloperGuidePage[] = [
	{
		slug: 'quickstart',
		title: 'Quickstart',
		group: 'Getting started',
		description: 'Make a bounded request and understand the data you receive.',
		sections: [
			{
				id: 'choose-an-api',
				title: 'Start with parsed analytics',
				content: (
					<>
						<p>
							Use the analytics API for parsed transactions, operations, asset
							activity and contract events. REST and typed GraphQL share the
							same warehouse query services. You do not need to decode raw
							ledger files to use these endpoints.
						</p>
						<p>
							The examples use the public API at <code>{api}</code>. Use{' '}
							<a href="/docs/graphql">the GraphQL runner</a> or{' '}
							<a href="/docs/api/listParsedOperations">
								the operations reference
							</a>{' '}
							to execute a request. No wallet signature or private key is needed
							for these reads.
						</p>
						<p>
							Each command below allows five seconds to connect and thirty
							seconds for the whole request, without automatic retries. A client
							timeout is a failed read, not evidence that rows are absent or that
							server work stopped. Treat a file saved by a failed request as
							incomplete; continue only after a successful response.
						</p>
						<p>
							For a wallet or token project, follow the{' '}
							<a href="/docs/assets-and-issuers#wallet-and-holders">
								KALE, wallet balances and asset holders quickstart
							</a>
							.
						</p>
					</>
				)
			},
			{
				id: 'inspect-coverage',
				title: '1. Check the available ledger ranges',
				content: (
					<>
						<Code>{`curl --fail-with-body --connect-timeout 5 --max-time 30 '${api}/v1/analytics/datasets'`}</Code>
						<p>
							The <a href="/docs/api/listHubbleDatasets">dataset catalog</a>{' '}
							includes table names, column types and coverage. Choose a small
							interval inside <code>coverage.completedRanges</code>. Backfill
							can contain a contiguous historical range plus separate completed
							intervals; the highest imported ledger does not imply everything
							before it is available.
						</p>
					</>
				)
			},
			{
				id: 'fetch-operations',
				title: '2. Read payment operations',
				content: (
					<>
						<Code>{`curl --fail-with-body --connect-timeout 5 --max-time 30 '${operationUrl}&offset=${operationInput.offset}' --output operations-page-1.json`}</Code>
						<p>
							This two-ledger window is an example, not a promise of current
							coverage. Replace it with a range from your catalog response. The
							result contains <code>rows</code>, <code>window</code>,{' '}
							<code>coverageStatus</code> and <code>nextOffset</code>.
							Operations include their type, source account, decoded details and
							transaction relationship.
						</p>
						<p>After the request succeeds, read these fields together:</p>
						<ul>
							<li>
								<code>window</code> identifies the ledger interval actually
								queried. Check it against the range you selected.
							</li>
							<li>
								<code>coverageStatus: complete</code> means the selected window
								is covered; it does not mean all chain history is available.
								For <code>partial_or_unknown</code>, choose a completed interval
								from the catalogue before drawing conclusions from missing rows.
							</li>
							<li>
								An empty <code>rows</code> array can be a valid result for your
								filters. It is different from a failed request. A non-null{' '}
								<code>nextOffset</code> continues this query; <code>null</code>{' '}
								ends it.
							</li>
						</ul>
						<p>
							If the request fails, follow{' '}
							<a href="/docs/querying#handle-errors">error handling</a> before
							trying a larger query. For the next workflow, use{' '}
							<a href="/docs/live-updates#publication-feed">
								publication notices for refreshing a view
							</a>{' '}
							or <a href="/docs/services#history-downloads">history downloads</a>{' '}
							for offline analysis.
						</p>
					</>
				)
			},
			{
				id: 'follow-results',
				title: '3. Follow a result, then paginate',
				content: (
					<>
						<p>
							Open a returned transaction hash with{' '}
							<code>GET /v1/analytics/transactions/{'{hash}'}?view=typed</code>.
							Supply <code>ledger_sequence</code> when known to narrow the
							lookup. The typed response has separately paginated operations,
							effects and events.
						</p>
						<p>
							For the operations list, repeat the same filters with the returned{' '}
							<code>nextOffset</code>. Stop when it is <code>null</code>. Check
							coverage before interpreting an empty result as absence.
						</p>
						<p>
							With <code>jq</code> installed, continue the saved response only
							when it supplies a <code>nextOffset</code>:
						</p>
						<Code>{`offset=$(jq -er '.nextOffset // empty' operations-page-1.json) &&
curl --fail-with-body --connect-timeout 5 --max-time 30 --get '${operationUrl}' \\
  --data-urlencode "offset=$offset"`}</Code>
						<p>
							Keep the first request’s window, filters and limit in the second
							URL. Use the returned offset rather than calculating it from row
							count. These offset pages can change during backfill; for long
							results, narrow the window instead of exceeding the route’s offset
							limit. See <a href="/docs/querying">pagination rules</a>.
						</p>
						<p>
							Next: <a href="/docs/querying">Filtering and pagination</a> ·{' '}
							<a href="/docs/graphql-guide">Typed GraphQL</a>
						</p>
					</>
				)
			}
		]
	},
	{
		slug: 'datasets',
		title: 'Datasets and coverage',
		group: 'Getting started',
		description:
			'Understand completed batches, historical observations and exact values.',
		sections: [
			{
				id: 'discover-schema',
				title: 'Discover the available schema',
				content: (
					<>
						<p>
							<code>GET /v1/analytics/datasets</code> lists the served tables.{' '}
							<code>GET /v1/analytics/datasets/{'{dataset}'}</code> returns a
							wrapper containing <code>dataset</code>, <code>database</code>,{' '}
							<code>generatedAt</code>, <code>ingestion</code> and{' '}
							<code>officialSchemaSource</code>.
						</p>
						<p>
							Use the returned column names and types for dataset queries.
							Examples include <code>history_transactions</code>,{' '}
							<code>history_operations</code>,{' '}
							<code>history_contract_events</code>, <code>history_trades</code>,{' '}
							<code>accounts</code>, <code>trustlines</code> and{' '}
							<code>offers</code>. The catalog, rather than a hard-coded table
							list, is the contract for your deployment.
						</p>
						<p>
							Catalog row counts are estimates of active ClickHouse rows, not
							counts of distinct accounts, unique checkpoints or fully verified
							archives.
						</p>
					</>
				)
			},
			{
				id: 'read-coverage',
				title: 'Read coverage as intervals',
				content: (
					<>
						<dl>
							<dt>
								<code>completedRanges</code>
							</dt>
							<dd>
								Disjoint completed ledger intervals, including supplemental
								imports.
							</dd>
							<dt>
								<code>contiguousFirstLedger / contiguousLastLedger</code>
							</dt>
							<dd>
								The completed historical prefix, starting from ledger 2 when
								available.
							</dd>
							<dt>
								<code>supplementalLedgerCount</code>
							</dt>
							<dd>Completed ledgers outside that contiguous prefix.</dd>
							<dt>
								<code>maximumLedger</code>
							</dt>
							<dd>
								The highest completed ledger, not a claim of complete history
								below it.
							</dd>
							<dt>
								<code>coverageStatus</code>
							</dt>
							<dd>
								On windowed entity queries, <code>complete</code> means the
								requested interval is covered; <code>partial_or_unknown</code>{' '}
								means absence is not established.
							</dd>
						</dl>
						<p>
							Public warehouse queries exclude in-flight and failed ingestion
							batches. A completed import describes parsed-data availability.
							Archive byte verification, source availability findings and
							cryptographic proof work are separate evidence systems.
						</p>
					</>
				)
			},
			{
				id: 'state-observations',
				title: 'Historical observations are not current state',
				content: (
					<>
						<p>
							Account balances and asset holders use the latest ingested
							observations. Their watermarks expose the catalog position and{' '}
							<code>snapshotPinned: false</code>; they are not current-chain or
							arbitrary-height balance proofs. Account balances accept only{' '}
							<code>after</code> and <code>limit</code>, not as-of filters.
							Asset holder lists accept <code>as_of_ledger</code> (GraphQL:{' '}
							<code>asOfLedger</code>) as an upper bound on ingested
							observations, up to the catalog’s maximum observed ledger. This
							does not pin a snapshot or prove complete state at that height;
							inspect{' '}
							<code>watermark.selectedLedger</code> and{' '}
							<code>watermark.coverageStatus</code> and retain the same bound
							while paging.
						</p>
						<p>
							Offer queries return historical changes, not a live order book.
							Asset and contract lists return identities observed in the
							selected window, not a complete current registry. A contract event
							can establish activity without a state record at that exact
							ledger.
						</p>
					</>
				)
			},
			{
				id: 'preserve-precision',
				title: 'Preserve identifiers and amount precision',
				content: (
					<>
						<p>
							Keep IDs, hashes, raw amounts and large numeric strings as
							strings. Converting them to JavaScript <code>Number</code> can
							lose precision. Read the response’s <code>amountPrecision</code>,
							raw-value fields and aggregate <code>approximate</code> flag.
						</p>
						<p>
							Some parsed balances and trade values originate as Float64
							observations. A decimal-looking string does not restore precision
							already lost upstream. Aggregate outputs are strings or null;
							Float64 and average results remain approximate.
						</p>
					</>
				)
			}
		]
	},
	...developerGuideQueryPages,
	contractEventsGuide,
	contractVerificationGuide,
	assetsAndIssuersGuide,
	liveUpdatesGuide,
	...developerGuideReferencePages,
	sdkPlanGuide
];

export function getDeveloperGuidePage(
	slug: string
): DeveloperGuidePage | undefined {
	return developerGuidePages.find((page) => page.slug === slug);
}
