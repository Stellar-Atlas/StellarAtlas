import { CapturingNoticeSink, dryRunNotices } from './notice-dry-run.mjs';

// This concrete transport has no network implementation or credentials.
export class OfflineNoticeTransport {
  captures = [];
  constructor(outcome = {status: 'accepted'}) { this.outcome = outcome; }
  async send(notice) {
    if (this.captures.length >= 100) throw new Error('Offline capture capacity reached');
    this.captures.push(structuredClone(notice));
    return structuredClone(this.outcome);
  }
}
class Proposals extends CapturingNoticeSink {
  async capture(notice) {
    this.captures.push(structuredClone(notice));
    // Evaluation advances observation/confirmation state, never delivery acknowledgement.
    throw new Error('Proposal only');
  }
}

// Explicit test-only entry point. Nothing imports this from a serving path.
export async function evaluateOfflineDelivery(store, status, token, transport) {
  if (!(transport instanceof OfflineNoticeTransport)) throw new TypeError('Offline fake transport required');
  const lease = await store.acquire(token);
  if (!lease) return {status: 'disabled_or_busy', deliveries: []};
  try {
    const collector = new Proposals(), state = await store.load(lease);
    const evaluation = await dryRunNotices(state, status, store.at(), collector);
    await store.stage(lease, evaluation.state, collector.captures);
    const deliveries = [];
    for (const proposal of collector.captures) {
      const notice = await store.start(lease, proposal.key);
      if (!notice) { deliveries.push({key: proposal.key, status: 'blocked'}); continue; }
      let result;
      try { result = await transport.send(notice); } catch { result = {status: 'unknown'}; }
      let outcome = 'uncertain';
      try {
        if (result?.status === 'accepted') { await store.accept(lease, notice.key); outcome = 'acknowledged'; }
        else if (['not_accepted', 'rate_limited'].includes(result?.status)) {
          await store.reject(lease, notice.key, result.retryAfterMs, result.status === 'rate_limited');
          outcome = result.status;
        } else await store.uncertain(lease, notice.key);
      } catch {
        // Lost SQL acknowledgement cannot justify repeating an external side effect.
        try { await store.uncertain(lease, notice.key); } catch { /* sending stays fenced and non-retryable */ }
      }
      deliveries.push({key: notice.key, status: outcome});
    }
    return {status: evaluation.skipped ?? 'evaluated', deliveries};
  } finally { await store.release(lease); }
}
