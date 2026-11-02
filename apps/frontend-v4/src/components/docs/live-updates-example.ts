import { api } from './developer-guide-elements';
import { contractEventExample } from '../blockchain/contract-event-query';
import { contractActivityPath } from '../../api/explorer-contract-activity';

export const liveUpdatesExample = `const eventUrl = '${api}${contractActivityPath(contractEventExample.contract_id!, 'events', contractEventExample)}';
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
      if (stopped) return;
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const page = await response.json();
      if (stopped) return;
      console.log('Refreshed bounded event page:', page);
    } catch (error) {
      if (!stopped) console.error('Refresh failed; retain the previous page:', error);
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
feed.onclose = () => {
  if (!stopped) console.info('Disconnected; recheck coverage before reconnecting.');
};

function stopUpdates() {
  stopped = true;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = false;
  request?.abort();
  feed.close();
  seen.clear();
}
// Call stopUpdates() when the view closes.`;
