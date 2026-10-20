import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';

export const developerGuideQueryPages: readonly DeveloperGuidePage[] = [
	{
		slug: 'querying',
		title: 'Filtering and pagination',
		group: 'Querying data',
		description:
			'Keep queries bounded, preserve cursor scope, and aggregate without raw SQL.',
		sections: [
			{
				id: 'discover-datasets',
				title: 'Discover datasets and columns',
				content: (
					<>
						<p>
							Use <code>GET /v1/datasets</code> to find available tables. Each
							dataset has a schema, completed ledger coverage and query routes.
						</p>
						<Code>{`curl --fail-with-body '${api}/v1/datasets/history_contract_events/schema'
curl --fail-with-body '${api}/v1/datasets/history_contract_events/records?ledger_sequence=64877689&select=ledger_sequence,contract_id,transaction_hash&limit=2'`}</Code>
						<p>
							Column names and types come from the schema endpoint. Use{' '}
							<code>select</code> to choose columns,{' '}
							<code>order=-ledger_sequence</code> for descending order, and the
							returned <code>nextOffset</code> for the next page. Keep filters
							unchanged. Metadata uses the shared catalogue; record queries
							remain bounded.
						</p>
						<p>
							A full final records page may be followed by one empty page; no
							total-count scan is run.
						</p>
					</>
				)
			},
			{
				id: 'bounded-windows',
				title: 'Choose an explicit window',
				content: (
					<>
						<p>
							Windowed REST entity endpoints use inclusive{' '}
							<code>min_ledger</code> and <code>max_ledger</code>. GraphQL uses{' '}
							<code>minLedger</code> and <code>maxLedger</code>. Optional UTC{' '}
							<code>start_time / end_time</code> filters use an inclusive start
							and exclusive end; GraphQL calls them{' '}
							<code>startTime / endTime</code>.
						</p>
						<p>
							Activity lists default to a small recent imported window. For
							repeatable analysis, supply your own bounds and retain the
							returned window. Unsupported filters fail validation instead of
							being interpreted as SQL.
						</p>
						<p>
							In the explorer, use <strong>Date &amp; ledger range</strong> for
							optional bounds. <strong>Latest published</strong> clears the
							range but keeps account, asset and operation filters. Use{' '}
							<strong>View API response</strong> to open the exact query behind
							the displayed result, including its window and pagination.
						</p>
					</>
				)
			},
			{
				id: 'page-types',
				title: 'Use the pagination contract for the route',
				content: (
					<>
						<ul>
							<li>
								Operations, contracts, trades and offers: <code>limit</code>{' '}
								from 1–100, <code>offset</code> from 0–10,000, and a returned{' '}
								<code>nextOffset</code>.
							</li>
							<li>
								Asset catalogue (<code>/v1/assets</code>): opaque{' '}
								<code>cursor</code>, returned <code>nextCursor</code>, and
								<code>limit</code> from 1–100. Asset discovery does not require
								a ledger window.
							</li>
							<li>
								Transfer activity and typed contract events: opaque{' '}
								<code>after</code> cursor, returned <code>nextCursor</code>, and
								a limit up to 200.
							</li>
							<li>
								Account balances and asset holders: route-scoped{' '}
								<code>after</code>, returned <code>nextCursor</code>, and a
								limit up to 200.
							</li>
							<li>
								Typed transaction relations: separate{' '}
								<code>operations_after</code>, <code>effects_after</code> and{' '}
								<code>events_after</code>. Do not exchange these cursors.
							</li>
						</ul>
						<p>
							Explorer entity lists offer 10, 25, 50 or 100 rows per page. Apply
							the selection to start at the first page; copied explorer URLs
							preserve the page size, filters and returned ledger window.
						</p>
						<p>
							Copy cursors unchanged and keep the original account, asset,
							filters and window. They are continuation tokens, not reusable
							identifiers or signed proofs. Ongoing ingestion and backfill can
							change later reads; cursor pagination is not a frozen warehouse
							snapshot.
						</p>
					</>
				)
			},
			{
				id: 'dataset-queries',
				title: 'Select columns and aggregate',
				content: (
					<>
						<p>
							<code>POST /v1/analytics/query</code> accepts a structured query
							against one catalog dataset. Select named columns, apply supported
							filters, or group with <code>count</code>,{' '}
							<code>count_distinct</code>, <code>sum</code>, <code>avg</code>,{' '}
							<code>min</code> and <code>max</code>. This is a bounded query
							API, not arbitrary SQL or an asynchronous query-job service.
						</p>
						<Code>{`curl --fail-with-body '${api}/v1/analytics/query' \\
  -H 'Content-Type: application/json' \\
  --data '${JSON.stringify({ dataset: 'history_operations', minLedger: 63490360, maxLedger: 63490365, groupBy: ['type_string'], aggregations: [{ function: 'count', alias: 'records' }], orderBy: [{ field: 'records', direction: 'desc' }], limit: 10, offset: 0 })}'`}</Code>
						<p>
							The dataset-specific equivalent is{' '}
							<code>POST /v1/datasets/{'{dataset}'}/query</code>. Existing{' '}
							<code>/v1/analytics</code> routes remain available. Grouped
							queries return metric metadata alongside rows and coverage. Use
							returned aliases in ordering; GraphQL uses uppercase function
							enums such as <code>COUNT</code>.
						</p>
					</>
				)
			},
			{
				id: 'handle-errors',
				title: 'Handle incomplete or unavailable results',
				content: (
					<>
						<p>
							Correct invalid inputs on HTTP 400. Typed explorer detail routes
							distinguish a missing record in a completed window (404) from a
							record not found in an incompletely ingested window (409). Other
							route families have their own documented error shapes.
						</p>
						<p>
							A timeout or unavailable warehouse can return 503. Narrow the
							window or retry with backoff; do not turn the failure into an
							empty successful result. GraphQL callers must inspect the{' '}
							<code>errors</code> array as well as the HTTP status.
						</p>
					</>
				)
			}
		]
	},
	{
		slug: 'rest',
		title: 'REST resources',
		group: 'Querying data',
		description:
			'Choose the entity or relationship you need, then use its documented filters.',
		sections: [
			{
				id: 'typed-resources',
				title: 'Entity lookups and lists',
				content: (
					<>
						<p>
							All paths below are relative to <code>{api}/v1</code>. Add{' '}
							<code>view=typed</code> to transaction details, operation details,
							trade lists and contract-event reads to select the typed
							representation; the legacy responses remain available.
						</p>
						<table>
							<thead>
								<tr>
									<th>Resource</th>
									<th>Routes</th>
									<th>Useful filters</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>Transactions</td>
									<td>
										<code>/transactions/{'{hash}'}?view=typed</code>
									</td>
									<td>
										Optional <code>ledger_sequence</code>; independent relation
										cursors.
									</td>
								</tr>
								<tr>
									<td>Operations</td>
									<td>
										<code>/operations</code>,{' '}
										<code>/operations/{'{id}'}?view=typed</code>
									</td>
									<td>
										<code>source_account</code>, <code>type</code> name or
										numeric code, window.
									</td>
								</tr>
								<tr>
									<td>Assets</td>
									<td>
										<code>/assets</code>, <code>/assets/{'{asset}'}</code>
									</td>
									<td>
										<code>q</code>, <code>symbol</code>, <code>issuer</code>,
										optional observed ledger/time bounds; cursor pagination.
									</td>
								</tr>
								<tr>
									<td>Contracts</td>
									<td>
										<code>/contracts</code>,{' '}
										<code>/contracts/{'{contractId}'}</code>
									</td>
									<td>Ledger and UTC time window.</td>
								</tr>
								<tr>
									<td>Trades</td>
									<td>
										<code>/trades?view=typed</code>,{' '}
										<code>/trades/{'{operationId:order}'}</code>
									</td>
									<td>
										<code>seller</code>, <code>buyer</code>,{' '}
										<code>selling_asset</code>, <code>buying_asset</code>,{' '}
										<code>operation_id</code>, window.
									</td>
								</tr>
								<tr>
									<td>Offers</td>
									<td>
										<code>/offers</code>, <code>/offers/{'{offerId}'}</code>
									</td>
									<td>
										<code>seller</code>, <code>selling_asset</code>,{' '}
										<code>buying_asset</code>, <code>offer_id</code>, window.
									</td>
								</tr>
							</tbody>
						</table>
						<p>
							The asset catalogue returns <code>data</code> and a{' '}
							<code>nextCursor</code>. Windowed entity lists return{' '}
							<code>rows</code>, <code>window</code> and <code>nextOffset</code>
							. Dataset-shaped compatibility routes remain available under{' '}
							<code>/v1/analytics</code>.
						</p>
						<p>
							Use <code>native</code> for XLM or <code>CODE:ISSUER</code> for an
							issued asset. URL-encode path identifiers. Offer detail is the
							latest observation inside the selected window, not the current
							offer state.
						</p>
					</>
				)
			},
			{
				id: 'historical-pair-report',
				title: 'Investigate a historical asset pair',
				content: (
					<>
						<p>
							Open <a href="/explorer/markets">Pair reports</a>, choose two
							classic assets, and optionally set a ledger interval of up to
							2,048 ledgers. The report pins all four sections to the same
							published window: trades in each direction and native pools in
							either asset ordering. Each section has its own pagination and
							JSON link. Pool observations are not separate pools, current
							depth, or executable quotes.
						</p>
						<Code>{`curl --fail-with-body --get '${api}/v1/trades' \\
  --data-urlencode 'view=typed' \\
  --data-urlencode 'selling_asset=native' \\
  --data-urlencode 'buying_asset=AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA' \\
  --data-urlencode 'min_ledger=64987203' \\
  --data-urlencode 'max_ledger=64987266' \\
  --data-urlencode 'limit=10'`}</Code>
						<p>
							Swap <code>selling_asset</code> and <code>buying_asset</code> for
							the other trade direction. Historical pool observations use{' '}
							<code>GET /v1/analytics/liquidity-pools</code> with{' '}
							<code>asset_a</code>, <code>asset_b</code>, and the same window;
							query both orderings. Follow each response’s own{' '}
							<code>nextOffset</code> without changing its filters.
						</p>
						<Code>{`query HistoricalPair($a: String!, $b: String!, $min: Int!, $max: Int!) {
  aToB: hubbleTrades(input: {sellingAsset: $a, buyingAsset: $b, minLedger: $min, maxLedger: $max, limit: 10}) {
    window { minLedger maxLedger } coverageStatus nextOffset
    rows { id operationId ledgerSequence sellingAmount buyingAmount amountPrecision }
  }
  bToA: hubbleTrades(input: {sellingAsset: $b, buyingAsset: $a, minLedger: $min, maxLedger: $max, limit: 10}) {
    coverageStatus nextOffset
    rows { id operationId ledgerSequence sellingAmount buyingAmount amountPrecision }
  }
  poolsAB: nativeLiquidityPools(input: {assetA: $a, assetB: $b, minLedger: $min, maxLedger: $max, limit: 10}) {
    coverageStatus nextOffset
    rows { id ledgerSequence reserveA reserveB amountPrecision }
  }
  poolsBA: nativeLiquidityPools(input: {assetA: $b, assetB: $a, minLedger: $min, maxLedger: $max, limit: 10}) {
    coverageStatus nextOffset
    rows { id ledgerSequence reserveA reserveB amountPrecision }
  }
}`}</Code>
						<Code>{`{"a":"native","b":"AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA","min":64987203,"max":64987266}`}</Code>
						<p>
							Run the query and variables in the{' '}
							<a href="/docs/graphql">GraphQL workspace</a>. Amounts marked{' '}
							<code>source_float64</code> retain source rounding; page sums are
							not complete interval volume. In the explorer, linked records
							retain the original investigation URL, including filters and page.
							Use <strong>Back to results</strong> to return.
						</p>
					</>
				)
			},
			{
				id: 'contract-invocations',
				title: 'Find contract invocations',
				content: (
					<>
						<Code>{`curl --fail-with-body '${api}/v1/operations?type=invoke_host_function&limit=10'`}</Code>
						<p>
							For contract calls, <code>details.contract_id</code> identifies
							the contract. The first two entries in{' '}
							<code>details.parameters_json_decoded</code> contain its address
							and function symbol; remaining entries are typed arguments. The
							explorer links these calls to contract details and the transaction
							result. Other host-function operations may have different fields;
							do not interpret an upload or deployment as a contract call.
						</p>
					</>
				)
			},
			{
				id: 'account-asset-relations',
				title: 'Account and asset relationships',
				content: (
					<>
						<ul>
							<li>
								<code>/accounts/{'{account}'}/balances</code>: latest-ingested
								native and trustline observations.
							</li>
							<li>
								<code>/assets/{'{asset}'}/holders</code> and{' '}
								<code>
									/assets/{'{asset}'}/holders/{'{account}'}
								</code>
								: positive latest-ingested holder observations.
							</li>
							<li>
								<code>/accounts/{'{account}'}/transactions</code> and{' '}
								<code>/accounts/{'{account}'}/effects</code>: dataset-shaped
								account history reads.
							</li>
							<li>
								<code>/activity/transfers</code>,{' '}
								<code>/accounts/{'{account}'}/activity/transfers</code> and{' '}
								<code>/assets/{'{asset}'}/activity/transfers</code>: the shared
								transfer-activity surface.
							</li>
						</ul>
						<p>
							Transfer activity supports account, from/to, asset, contract,
							transaction hash, event topic, ledger/time bounds and raw-amount
							filters. Raw amounts are asset-specific units; do not compare
							different assets as though they shared a scale.
						</p>
					</>
				)
			},
			{
				id: 'contract-events',
				title: 'Decoded contract events',
				content: (
					<>
						<p>
							<code>/contracts/{'{contractId}'}/events?view=typed</code> returns
							decoded topics and data alongside source fields, classification,
							coverage and a cursor. Filters include{' '}
							<code>transaction_hash</code>, <code>type_code</code>,{' '}
							<code>successful</code> and{' '}
							<code>in_successful_contract_call</code>.
						</p>
						<p>
							Use the event classification and its provenance when separating
							contract execution from other event records. The presence of a
							contract-addressed event alone is not proof that a Soroban
							invocation executed.
						</p>
						<p>
							The <a href="/docs/api">interactive REST reference</a> documents
							every field, parameter and response. Download the{' '}
							<a href="/api-docs/openapi.json">OpenAPI JSON</a> for client
							generation.
						</p>
					</>
				)
			}
		]
	}
];
