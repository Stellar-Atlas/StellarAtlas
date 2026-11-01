import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';
import { contractEventExample } from '../blockchain/contract-event-query';
import { contractActivityPath } from '../../api/explorer-contract-activity';

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
						From a StellarAtlas page, refresh one bounded event page after a
						relevant notice. This uses the shared historical example: only
						publications overlapping that example’s ledger window cause a read.
					</p>
					<Code language="javascript">{`const eventUrl = '${api}${contractActivityPath(contractEventExample.contract_id!, 'events', contractEventExample)}';
const feed = new WebSocket('wss://api.stellaratlas.io/v1/stream/data');
const seen = new Set();
let timer = null, request = null, pending = false, stopped = false;

function queueRefresh() {
  if (stopped || timer !== null || request !== null) return;
  timer = setTimeout(async () => {
    timer = null;
    if (stopped) return;
    pending = false;
    request = new AbortController();
    const deadline = setTimeout(() => request?.abort(), 10_000);
    try {
      const response = await fetch(eventUrl, { signal: request.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      console.log('Refreshed bounded event page:', await response.json());
    } catch (error) {
      console.error('Refresh failed; retain the previous page:', error);
    } finally {
      clearTimeout(deadline);
      request = null;
      if (pending) queueRefresh();
    }
  }, 250);
}

feed.onmessage = ({ data }) => {
  if (stopped || typeof data !== 'string' || data.length > 4096) return;
  let notice;
  try { notice = JSON.parse(data); } catch { return; }
  if (notice?.version !== 1 || notice.event !== 'datasets.published' ||
      typeof notice.batchId !== 'string' || !Array.isArray(notice.datasets) ||
      !notice.datasets.includes('history_contract_events')) return;
  if (!Number.isSafeInteger(notice.minLedger) || !Number.isSafeInteger(notice.maxLedger) ||
      notice.minLedger > notice.maxLedger) return;
  if (notice.maxLedger < ${contractEventExample.min_ledger} || notice.minLedger > ${contractEventExample.max_ledger}) return;
  if (seen.has(notice.batchId)) return;
  seen.add(notice.batchId);
  while (seen.size > 256) seen.delete(seen.values().next().value);
  pending = true;
  queueRefresh();
};
feed.onclose = () => console.info('Disconnected; recheck coverage before reconnecting.');

function stopUpdates() {
  stopped = true;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = false;
  request?.abort();
  feed.close();
  seen.clear();
}
// Call stopUpdates() when the view closes.`}</Code>
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
		}
	]
};
