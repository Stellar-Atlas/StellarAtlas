import {
	api,
	sampleWindow,
	Code,
	type DeveloperGuidePage
} from './developer-guide-elements';
import { developerGuideQueryPages } from './developer-guide-query-content';
import { developerGuideReferencePages } from './developer-guide-reference-content';
export type {
	DeveloperGuidePage,
	DeveloperGuideSection
} from './developer-guide-elements';

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
					</>
				)
			},
			{
				id: 'inspect-coverage',
				title: '1. Check the available ledger ranges',
				content: (
					<>
						<Code>{`curl --fail-with-body '${api}/v1/analytics/datasets'`}</Code>
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
						<Code>{`curl --fail-with-body '${api}/v1/analytics/operations?${sampleWindow}&type=payment&limit=10&offset=0'`}</Code>
						<p>
							This two-ledger window is an example, not a promise of current
							coverage. Replace it with a range from your catalog response. The
							result contains <code>rows</code>, <code>window</code>,{' '}
							<code>coverageStatus</code> and <code>nextOffset</code>.
							Operations include their type, source account, decoded details and
							transaction relationship.
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
							<code>accounts</code>, <code>trust_lines</code> and{' '}
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
							arbitrary-height balance proofs. These routes do not accept
							current/as-of state parameters.
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
	...developerGuideReferencePages
];

export function getDeveloperGuidePage(
	slug: string
): DeveloperGuidePage | undefined {
	return developerGuidePages.find((page) => page.slug === slug);
}
