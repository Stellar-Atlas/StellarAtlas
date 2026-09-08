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
							Entity lists default to a small recent imported window. For
							repeatable analysis, supply your own bounds and retain the
							returned window. Unsupported filters fail validation instead of
							being interpreted as SQL.
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
								Operations, assets, contracts, trades and offers:{' '}
								<code>limit</code> from 1–100, <code>offset</code> from
								0–10,000, and a returned <code>nextOffset</code>.
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
							<code>POST /v1/analytics/datasets/{'{dataset}'}/query</code>.
							Grouped queries return metric metadata alongside rows and
							coverage. Use returned aliases in ordering; GraphQL uses uppercase
							function enums such as <code>COUNT</code>.
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
							All paths below are relative to <code>{api}/v1/analytics</code>.
							Add <code>view=typed</code> to transaction details, operation
							details, trade lists and contract-event reads to select the typed
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
										<code>asset_code</code>, <code>asset_issuer</code>, window.
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
							Use <code>native</code> for XLM or <code>CODE:ISSUER</code> for an
							issued asset. URL-encode path identifiers. Offer detail is the
							latest observation inside the selected window, not the current
							offer state.
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
