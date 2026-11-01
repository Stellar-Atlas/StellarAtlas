import { Code, type DeveloperGuidePage } from './developer-guide-elements';

export const liveUpdatesGuide: DeveloperGuidePage = {
	slug: 'live-updates',
	title: 'WebSocket updates',
	group: 'Querying data',
	description:
		'Receive publication notices, then fetch only the data you need.',
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
						From a StellarAtlas page, filter publication notices before
						refreshing:
					</p>
					<Code>{`const feed = new WebSocket('wss://api.stellaratlas.io/v1/stream/data');
feed.onmessage = ({ data }) => {
  const notice = JSON.parse(data);
  if (notice.event !== 'datasets.published') return;
  if (!notice.datasets.includes('history_contract_events')) return;
  console.log(notice.batchId, notice.minLedger, notice.maxLedger);
  // Refresh the visible event page using its existing filters and limit.
};`}</Code>
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
		}
	]
};
