import { Code, type DeveloperGuidePage } from './developer-guide-elements';
import { liveUpdatesExample } from './live-updates-example';
import { networkSseExample } from './network-sse-example';
import { networkWebSocketExample } from './network-websocket-example';

export const liveUpdatesGuide: DeveloperGuidePage = {
	slug: 'live-updates',
	title: 'WebSocket and SSE updates',
	group: 'Querying data',
	description:
		'Distinguish dataset publication notices from network and SCP observation streams.',
	sections: [
		{
			id: 'publication-feed',
			title: 'Publication notifications',
			content: (
				<>
					<p>
						<code>wss://api.stellaratlas.io/v1/stream/data</code> reports newly
						published dataset batches. It does not repeatedly send entire tables
						or stream every contract event.
					</p>
					<p>
						Browser connections currently accept only the{' '}
						<code>https://stellaratlas.io</code> origin. This is the Explorer’s
						first-party update feed, not a general cross-origin subscription
						API.
					</p>
					<p>
						A connection starts with{' '}
						<code>{'{"version":1,"event":"ready"}'}</code>. No subscribe message
						is required. Subsequent messages have this shape:
					</p>
					<Code>{`{
  "version": 1,
  "event": "datasets.published",
  "batchId": "00000000-0000-4000-8000-000000000001",
  "minLedger": 65239200,
  "maxLedger": 65239263,
  "publishedAt": "2026-10-31T21:30:00.000Z",
  "datasets": ["history_contract_events", "history_transactions"]
}`}</Code>
					<p>
						The values above illustrate the message format.{' '}
						<code>minLedger</code> and <code>maxLedger</code> are inclusive.{' '}
						<code>datasets</code> identifies affected tables; the notice does
						not contain their rows.
					</p>
				</>
			)
		},
		{
			id: 'read-after-change',
			title: 'Refresh the affected view',
			content: (
				<>
					<p>
						From a StellarAtlas page, refresh one bounded event page after a
						relevant notice. This uses the shared historical example: only
						publications overlapping that example’s ledger window cause a read.
					</p>
					<Code language="javascript">{liveUpdatesExample}</Code>
					<p>
						Notices coalesce for 250 milliseconds, with one request in flight
						and at most 256 remembered batch IDs. Each read has a ten-second
						deadline. This single-session example does not retry failed reads or
						reconnect automatically; call <code>stopUpdates()</code> on cleanup.
						A queued new notice may schedule the next bounded read.
					</p>
					<p>
						Use{' '}
						<a href="/docs/contract-events">
							the contract event REST or GraphQL query
						</a>{' '}
						to retrieve actual events. Keep the contract, topic, order and
						page-size filters. Coalesce notices and deduplicate by{' '}
						<code>batchId</code>; do not download a complete dataset after every
						notice.
					</p>
					<p>
						This JSON message protocol is separate from GraphQL requests. Do not
						send <code>graphql-ws</code> connection or subscription messages to
						this endpoint. Address arrays and protocol-specific event
						subscriptions are not filters on this publication feed.
					</p>
				</>
			)
		},
		{
			id: 'reconnect-and-catch-up',
			title: 'Reconnect without losing query coverage',
			content: (
				<>
					<p>
						These notices are freshness hints, not a replayable event log. After
						reconnecting, recheck coverage and refresh the visible query.
						Continue historical event pagination using <code>nextCursor</code>,
						with unchanged filters.
					</p>
					<p>
						Share one connection across active views, close it when no longer
						needed, and reconnect with capped backoff rather than a tight loop.
						A slow client may be closed with code <code>1013</code>. WebSocket
						ping/pong heartbeats are handled by the browser; silence does not
						mean there are missing dataset rows.
					</p>
				</>
			)
		},
		{
			id: 'network-sse',
			title: 'Network and SCP Server-Sent Events',
			content: (
				<>
					<p>
						These separate HTTP feeds use <code>text/event-stream</code>, not
						the publication WebSocket protocol. Paths below use the same API
						base. Listen for named events with <code>addEventListener</code>;{' '}
						<code>onmessage</code> alone does not receive them.
					</p>
					<table>
						<thead>
							<tr>
								<th>GET path</th>
								<th>Named events</th>
								<th>Data</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>
									<code>/v1/live</code>
								</td>
								<td>
									<code>network</code>, <code>error</code>
								</td>
								<td>Network snapshot or an unavailable-snapshot message.</td>
							</tr>
							<tr>
								<td>
									<code>/v1/scp-statements/live</code>
								</td>
								<td>
									<code>scp-metadata</code>, <code>scp</code>,{' '}
									<code>error</code>
								</td>
								<td>
									Observation source/freshness metadata and SCP statement
									batches.
								</td>
							</tr>
						</tbody>
					</table>
					<p>
						The network feed attempts an initial snapshot, then polls every five
						seconds without overlapping reads. That interval does not prove the
						snapshot is fresh. HTTP 200 can still carry a named{' '}
						<code>error</code> event; it is not an empty successful snapshot.
						SCP connections at capacity return HTTP 503 before starting the
						stream. Check <code>scp-metadata</code> source and freshness before
						treating observations as current.
					</p>
					<p>
						From a StellarAtlas page, this example retains the response as JSON
						text, closes on the first server or transport error, and leaves
						previous data available. Call its cleanup function when leaving the
						view. Native EventSource can reconnect automatically; closing it
						here prevents that retry. Browser HTTP CORS rules still apply.
					</p>
					<Code language="javascript">{networkSseExample}</Code>
					<p>
						These streams do not publish wallet balances, asset holders or
						contract-event rows. They are not a failover replacement for
						unavailable analytics, and they do not implement Last-Event-ID
						replay. A reconnect is a new observation session, not proof of
						complete history. Keep historical pagination and coverage checks
						with the relevant REST or GraphQL query.
					</p>
				</>
			)
		},
		{
			id: 'network-websocket',
			title: 'Network and SCP WebSocket channels',
			content: (
				<>
					<p>
						<code>wss://api.stellaratlas.io/v1/live/ws</code> is a separate
						observation protocol. Select comma-separated <code>channels</code>{' '}
						in the connection URL; do not send a JSON subscribe message or the
						publication feed’s ready/dataset protocol.
					</p>
					<table>
						<thead>
							<tr>
								<th>Channel</th>
								<th>Message types</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>
									<code>summary</code>
								</td>
								<td>
									<code>summary</code> and <code>latestLedger</code>
								</td>
							</tr>
							<tr>
								<td>
									<code>network</code>
								</td>
								<td>
									<code>network</code> and <code>latestLedger</code>
								</td>
							</tr>
							<tr>
								<td>
									<code>scp</code>
								</td>
								<td>
									<code>scp</code>, or <code>scpGraph</code> with{' '}
									<code>scpMode=graph</code>
								</td>
							</tr>
						</tbody>
					</table>
					<p>
						Messages use a <code>type</code> and <code>payload</code>; all
						connections may also receive <code>heartbeat</code> and{' '}
						<code>error</code>. Omitting channels selects network and full SCP,
						without summary. Omit <code>scpMode</code> for full SCP;{' '}
						<code>scpMode=full</code> is not accepted. Unknown/duplicate
						channels, repeated selectors or graph mode without SCP fail upgrade
						validation with HTTP 400.
					</p>
					<p>
						SCP frames include <code>source</code>, <code>freshness</code>,{' '}
						<code>freshnessMs</code>, <code>observedAt</code>,{' '}
						<code>cursor</code> and <code>truncated</code>. For an explicit
						reconnect, pass both cursor fields as <code>afterObservedAtMs</code>{' '}
						and URL-encoded <code>afterStatementHash</code>, exactly once each.
						The timestamp is a nonnegative safe integer in milliseconds, not a
						ledger number. This resumes within retained observations ordered by
						observation time and statement hash; it is not arbitrary historical
						replay. The cursor affects SCP only; it does not rewind network,
						summary or latest-ledger snapshots. <code>truncated=true</code>{' '}
						means the bounded update may have more data; false does not prove
						complete network history.
					</p>
					<p>
						Check source/freshness even after a successful connection. A
						latest-ledger message may identify a Horizon fallback; that is not
						live SCP sourcing from public RPC or analytics failover. A heartbeat
						indicates connection activity, not fresh or complete data. Server
						errors can arrive in an open connection; capacity/backpressure can
						close it with 1013, and send failures with 1011.
					</p>
					<p>
						Unlike the publication feed, this retained network/SCP handler has
						no application-level Origin allowlist. HTTP CORS is not WebSocket
						authorization, and deployment/edge restrictions may still apply;
						this is not a live cross-origin acceptance claim.
					</p>
					<p>
						The single-session example below selects summary and compact SCP. It
						inspects the envelope and logs original JSON text without converting
						string identifiers, slot indices or values to Number. It does not
						validate the full payload, automatically reconnect or advance a
						resume cursor. The frontend’s existing{' '}
						<code>subscribeToLiveNetworkStream</code> helper handles validation,
						shared subscriptions and bounded reconnects; its cursor resets when
						SCP mode changes or a hidden tab becomes visible again.
					</p>
					<Code language="javascript">{networkWebSocketExample}</Code>
				</>
			)
		}
	]
};
