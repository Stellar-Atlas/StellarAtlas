import { componentNames, instant, noticeInput, noticeKey, noticePolicy, problemKind, renderNotice } from './notice-input.mjs';

export function emptyNoticeState() {
  return {version: noticePolicy.version, observedAt: null, fingerprint: null, conflicted: false, samples: {}, acknowledged: [], cooldowns: {}};
}

export class CapturingNoticeSink {
  captures = [];
  failNext = false;
  async capture(notice) {
    if (this.failNext) { this.failNext = false; throw new Error('Simulated notice rejection'); }
    if (this.captures.length >= 100) throw new Error('Capture bound exceeded');
    this.captures.push(structuredClone(notice));
  }
}

function checkedState(value) {
  if (!value || value.version !== noticePolicy.version || !Array.isArray(value.acknowledged)
      || value.acknowledged.length > noticePolicy.maxAcknowledgements || typeof value.conflicted !== 'boolean'
      || typeof value.samples !== 'object' || value.samples === null || Array.isArray(value.samples)
      || typeof value.cooldowns !== 'object' || value.cooldowns === null || Array.isArray(value.cooldowns))
    throw new TypeError('Invalid dry-run state');
  if (value.observedAt !== null) instant(value.observedAt);
  if (value.fingerprint !== null && typeof value.fingerprint !== 'string') throw new TypeError('Invalid state fingerprint');
  for (const [id, sample] of Object.entries(value.samples)) {
    if (!Object.hasOwn(componentNames,id) || !sample || typeof sample.key !== 'string' || !Number.isSafeInteger(sample.count) || sample.count < 1)
      throw new TypeError('Invalid confirmation state');
    instant(sample.firstAt); instant(sample.lastAt);
    if (sample.firstAt > sample.lastAt) throw new TypeError('Invalid confirmation interval');
  }
  const seen = new Set();
  for (const ack of value.acknowledged) {
    if (!ack || typeof ack.key !== 'string' || !Object.hasOwn(componentNames,ack.component)
        || !['outage','sustained_freshness','recovery'].includes(ack.kind) || seen.has(ack.key)
        || !Number.isSafeInteger(ack.incidentId) || ack.incidentId < 1) throw new TypeError('Invalid acknowledgement state');
    instant(ack.evidenceAt); seen.add(ack.key);
  }
  for (const [key, at] of Object.entries(value.cooldowns)) {
    if (!Object.keys(componentNames).some(id => key === `${id}:outage` || key === `${id}:sustained_freshness`))
      throw new TypeError('Invalid cooldown state');
    instant(at);
  }
  return structuredClone(value);
}

function sampleFor(previous, key, at) {
  if (!previous || previous.key !== key || at - previous.lastAt > noticePolicy.unknownAfterMs)
    return {key, firstAt: at, lastAt: at, count: 1};
  if (at <= previous.lastAt) return previous;
  return {...previous, lastAt: at, count: Math.min(1000,previous.count+1)};
}
function confirmed(sample, sustained = false) {
  return sample.count >= 2 && sample.lastAt - sample.firstAt >= (sustained ? noticePolicy.sustainedMs : noticePolicy.sampleIntervalMs);
}

// Explicit offline invocation only. No fetch, scheduler, production state or transport.
export async function dryRunNotices(prior, status, now, sink) {
  if (!(sink instanceof CapturingNoticeSink)) throw new TypeError('Capturing-only sink required');
  const state = checkedState(prior), input = noticeInput(status, now);
  const outcome = {state, captured: [], failed: [], skipped: null};
  if (!input) { outcome.skipped = 'stale_monitor'; return outcome; }
  const fingerprint = JSON.stringify(input);
  if (state.observedAt !== null && input.checkedAt < state.observedAt) { outcome.skipped = 'older_evidence'; return outcome; }
  if (input.checkedAt === state.observedAt && fingerprint !== state.fingerprint) {
    state.conflicted = true; state.samples = {}; outcome.skipped = 'equal_time_conflict'; return outcome;
  }
  if (input.checkedAt === state.observedAt && state.conflicted) { outcome.skipped = 'equal_time_conflict'; return outcome; }
  state.observedAt = input.checkedAt; state.fingerprint = fingerprint; state.conflicted = false;
  const proposals = [];
  for (const component of input.components) {
    const id = component.id;
    if (input.checkedAt - component.checkedAt > noticePolicy.unknownAfterMs || component.state === 'unknown') {
      delete state.samples[id]; continue;
    }
    const kind = problemKind(component);
    const monitorIncidents = input.incidents.filter(item => item.component === id && item.source === 'monitor' && item.confidence === 'confirmed');
    if (kind) {
      const open = monitorIncidents.filter(item => item.endedAt === null);
      if (open.length !== 1 || open[0].startedAt > component.checkedAt) { delete state.samples[id]; continue; }
      const incident = open[0], key = noticeKey(incident,kind);
      const sample = sampleFor(state.samples[id],key,component.checkedAt); state.samples[id] = sample;
      const cooldown = state.cooldowns[`${id}:${kind}`];
      if (confirmed(sample,kind === 'sustained_freshness') && !state.acknowledged.some(ack => ack.key === key)
          && (cooldown === undefined || sample.lastAt > cooldown + noticePolicy.cooldownMs))
        proposals.push(renderNotice(incident,kind,sample));
    } else if (component.state === 'operational' && ['ok','standby'].includes(component.reasonCode)) {
      const sample = sampleFor(state.samples[id],'healthy',component.checkedAt); state.samples[id] = sample;
      if (!confirmed(sample)) continue;
      const closed = monitorIncidents.filter(item => item.endedAt !== null && item.endedAt <= sample.firstAt)
        .sort((a,b) => b.endedAt-a.endedAt);
      for (const incident of closed) {
        const kinds = ['outage','sustained_freshness'].filter(kind => state.acknowledged.some(item => item.key === noticeKey(incident,kind)));
        if (kinds.length && !state.acknowledged.some(item => item.key === noticeKey(incident,'recovery'))) {
          proposals.push(renderNotice(incident,'recovery',sample,kinds)); break;
        }
      }
    } else delete state.samples[id];
  }
  if (state.acknowledged.length + proposals.length > noticePolicy.maxAcknowledgements) throw new Error('Acknowledgement bound exceeded');
  for (const notice of proposals) {
    try { await sink.capture(notice); }
    catch { outcome.failed.push(notice.key); continue; }
    const evidenceAt = Date.parse(notice.evidence.confirmedAt);
    state.acknowledged.push({key: notice.key, component: notice.component, incidentId: notice.incidentId, kind: notice.kind, evidenceAt});
    if (notice.kind !== 'recovery') state.cooldowns[`${notice.component}:${notice.kind}`] = evidenceAt;
    outcome.captured.push(notice);
  }
  return outcome;
}
