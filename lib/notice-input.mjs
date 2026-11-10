import { safeProbeDetail } from './incident-details.mjs';

export const noticePolicy = Object.freeze({
  version: 1, sampleIntervalMs: 60_000, unknownAfterMs: 180_000,
  sustainedMs: 300_000, cooldownMs: 900_000, maxHistory: 1000, maxAcknowledgements: 2000,
});
export const componentNames = Object.freeze({primary: 'Primary server', data: 'Data server', failover: 'Failover service'});
const reasons = new Set(['ok', 'standby', 'origin_unavailable', 'data_unavailable', 'snapshot_unavailable', 'data_stale', 'monitor_unavailable']);
export function instant(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid notice timestamp');
  return value;
}
export function noticeInput(status, now) {
  instant(now);
  if (!status || status.historyComplete !== true || !Array.isArray(status.components)
      || status.components.length !== 3 || !Array.isArray(status.recentIncidents)
      || status.recentIncidents.length > noticePolicy.maxHistory) throw new TypeError('Incomplete notice evidence');
  const checkedAt = instant(status.lastCheckedAt);
  if (checkedAt > now || now - checkedAt > noticePolicy.unknownAfterMs) return null;
  const ids = Object.keys(componentNames);
  const components = ids.map(id => {
    const matches = status.components.filter(item => item?.id === id);
    if (matches.length !== 1) throw new TypeError('Invalid notice component');
    const item = matches[0], at = instant(item.checkedAt);
    if (at > checkedAt || !['operational','degraded','unknown'].includes(item.state) || !reasons.has(item.reasonCode))
      throw new TypeError('Invalid notice observation');
    return {id, state: item.state, reasonCode: item.reasonCode, checkedAt: at, probeDetail: safeProbeDetail(item.probeDetail)};
  });
  const seen = new Set();
  const incidents = status.recentIncidents.map(item => {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || seen.has(item.id)
        || !ids.includes(item.component) || !reasons.has(item.reasonCode)
        || !['monitor','historical'].includes(item.source) || !['confirmed','inferred'].includes(item.confidence))
      throw new TypeError('Invalid notice incident');
    seen.add(item.id);
    const startedAt = instant(item.startedAt), endedAt = item.endedAt === null ? null : instant(item.endedAt);
    if (startedAt > checkedAt || endedAt !== null && (endedAt < startedAt || endedAt > checkedAt))
      throw new TypeError('Invalid notice incident interval');
    return {id: item.id, component: item.component, startedAt, endedAt, reasonCode: item.reasonCode,
      source: item.source, confidence: item.confidence};
  }).sort((a,b) => a.id-b.id);
  return {checkedAt, components, incidents};
}

export function problemKind(component) {
  if (component.state !== 'degraded' || component.probeDetail?.check === 'archive') return null;
  if (component.id === 'data' && component.reasonCode === 'data_stale') return 'sustained_freshness';
  if ({primary: 'origin_unavailable', data: 'data_unavailable', failover: 'snapshot_unavailable'}[component.id] === component.reasonCode)
    return 'outage';
  return null;
}

export function noticeKey(incident, kind) {
  return ['public-notice', noticePolicy.version, incident.component, incident.id, incident.startedAt, kind].join(':');
}

export function renderNotice(incident, kind, sample, recovers = []) {
  const name = componentNames[incident.component];
  const label = kind === 'outage' ? `${name}: availability checks failing.`
    : kind === 'sustained_freshness' ? `${name}: sustained freshness delay.`
    : recovers.length === 2 ? `${name}: availability and freshness checks recovered.`
    : recovers.includes('sustained_freshness') ? `${name}: freshness checks recovered.` : `${name}: availability checks recovered.`;
  const evidence = {sampledStartAt: new Date(incident.startedAt).toISOString(),
    confirmationStartedAt: new Date(sample.firstAt).toISOString(), confirmedAt: new Date(sample.lastAt).toISOString(),
    sampledRecoveryAt: kind === 'recovery' ? new Date(incident.endedAt).toISOString() : null};
  const times = kind === 'recovery'
    ? `Recovery observed ${evidence.sampledRecoveryAt}; confirmed ${evidence.confirmedAt}.`
    : `Observed ${evidence.sampledStartAt}; confirmed ${evidence.confirmedAt}.`;
  return {key: noticeKey(incident, kind), kind, component: incident.component, incidentId: incident.id,
    recovers, evidence, statusUrl: 'https://status.stellaratlas.io/', evidenceUrl: 'https://status.stellaratlas.io/api/status',
    text: `${label} ${times} https://status.stellaratlas.io/`};
}
