import {
	api,
	Code,
	GraphqlExample,
	type DeveloperGuidePage
} from './developer-guide-elements';
import {
	contractEventExample,
	contractEventWorkspaceHref
} from '../blockchain/contract-event-query';
import { contractActivityPath } from '../../api/explorer-contract-activity';

export const contractEventsGuide: DeveloperGuidePage = {
	slug: 'contract-events',
	title: 'Contract events',
	group: 'Querying data',
	description:
		'Query decoded events, inspect their transaction context, and paginate with REST or GraphQL.',
	sections: [
		{
			id: 'try-events',
			title: 'Explore an event before writing code',
			content: (
				<>
					<p>
						The <a href="/explorer/contract-events">contract-events explorer</a>{' '}
						lets you enter a contract address, choose a ledger interval, and
						filter by event type, transaction hash, transaction outcome, and
						contract-call outcome.
					</p>
					<p>
						<a href={contractEventWorkspaceHref(contractEventExample)}>
							Open an imported example
						</a>
						. Inspect decoded topics and payloads, follow{' '}
						<strong>Open transaction</strong> for its operations and related
						events, then use <strong>Next events</strong> to continue. The
						example is historical; it is not a live feed.
					</p>
					<p>
						For your own query, choose an interval from the{' '}
						<a href="/docs/api/listHubbleDatasets">
							dataset catalog’s completed ranges
						</a>
						. An empty response outside imported coverage does not establish
						that a contract had no activity.
					</p>
				</>
			)
		},
		{
			id: 'request-events',
			title: 'Read decoded events with REST',
			content: (
				<>
					<Code>{`curl --fail-with-body '${api}${contractActivityPath(contractEventExample.contract_id!, 'events', contractEventExample)}'`}</Code>
					<p>
						The dynamic route is{' '}
						<code>GET /v1/analytics/contracts/{'{contractId}'}/events</code>.
						Use <code>view=typed</code> for <code>items</code>, decoded JSON,
						classification, coverage, and <code>nextCursor</code>. The{' '}
						<a href="/docs/api/listAnalyticsContractEvents">
							interactive endpoint reference
						</a>{' '}
						includes all parameters and the response schema.
					</p>
					<dl>
						<dt>
							<code>type_code</code>
						</dt>
						<dd>
							0: system; 1: contract; 2: diagnostic. Omit to include all types.
						</dd>
						<dt>
							<code>transaction_hash</code>
						</dt>
						<dd>Restrict the contract’s events to one transaction.</dd>
						<dt>
							<code>successful</code>
						</dt>
						<dd>
							The enclosing transaction’s outcome. Set false to inspect failed
							transactions.
						</dd>
						<dt>
							<code>in_successful_contract_call</code>
						</dt>
						<dd>
							The recorded call-success flag. This is distinct from the
							transaction outcome.
						</dd>
						<dt>
							<code>min_ledger / max_ledger</code>
						</dt>
						<dd>Inclusive bounds, up to 1,000,000 ledgers per typed query.</dd>
						<dt>
							<code>start_time / end_time</code>
						</dt>
						<dd>
							Optional additional timestamp filters: inclusive start, exclusive
							end, in UTC ending in Z. They constrain the ledger window rather
							than replace it.
						</dd>
					</dl>
				</>
			)
		},
		{
			id: 'read-event',
			title: 'Understand an event record',
			content: (
				<>
					<dl>
						<dt>
							<code>
								id · contractId · transactionHash · ledgerSequence · closedAt
							</code>
						</dt>
						<dd>
							Identify the event, emitting contract, transaction, ledger and
							close time.
						</dd>
						<dt>
							<code>topicsJson · dataJson</code>
						</dt>
						<dd>
							Decoded topic and payload JSON retained as strings. Preserve large
							integer tokens; JavaScript Number may round them.
						</dd>
						<dt>
							<code>classification</code>
						</dt>
						<dd>
							Describes the recorded transaction kind, event kind, execution
							evidence and provenance. A system event or native fee does not by
							itself establish Soroban execution.
						</dd>
					</dl>
					<p>
						Contract events are application-defined. An event is not
						automatically a token transfer, balance update, or proof that a call
						succeeded. Use the success flags, decoded payload, and transaction
						context together. The explorer retains the original record/XDR in an
						expandable section.
					</p>
					<p>
						For recorded contract key/value changes, use{' '}
						<a href="/docs/api/listAnalyticsContractState">
							contract state history
						</a>
						. That endpoint is not a complete state snapshot at an arbitrary
						height.
					</p>
				</>
			)
		},
		{
			id: 'paginate-events',
			title: 'Continue without skipping or repeating a page',
			content: (
				<>
					<p>
						Copy <code>nextCursor</code> into <code>after</code> and preserve
						the contract and all filters. Do not send <code>offset</code> with
						the typed view. Stop when <code>nextCursor</code> is null. Changing
						filters starts a new query without the old cursor.
					</p>
					<p>
						Pages are ordered by descending ledger and stable source-row
						identifiers. The watermark identifies the queried interval; it does
						not freeze the warehouse. Later ingestion can add events inside
						previously queried history, so a complete historical export also
						needs coverage checks and a later reconciliation pass.
					</p>
					<p>
						HTTP 400 indicates invalid parameters or cursor. HTTP 503 indicates
						unavailable analytics service—not evidence that the contract has no
						events. The explorer keeps a successful page visible if the next
						request fails and offers Retry.
					</p>
				</>
			)
		},
		{
			id: 'graphql-events',
			title: 'Query the same events with GraphQL',
			content: (
				<>
					<p>
						Open the <a href="/docs/graphql">GraphQL runner</a>, select{' '}
						<strong>
							Historical contract events with decoded topics and data
						</strong>
						, and execute. Its schema explorer documents the available fields.
					</p>
					<GraphqlExample example="events" />
					<p>
						Use the returned cursor as <code>input.after</code>, keeping the
						other input fields unchanged. REST and GraphQL read the same parsed
						dataset; they do not perform separate ingestion.
					</p>
				</>
			)
		}
	]
};
