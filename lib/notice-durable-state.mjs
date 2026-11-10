import { componentNames, instant, noticeInput, noticePolicy } from './notice-input.mjs';

const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
function identity(key, component, kind, incidentId) {
  if (typeof key !== 'string' || key.length > 256) throw new TypeError('Invalid notice identity');
  const match = /^public-notice:1:(primary|data|failover):([1-9]\d*):(\d+):(outage|sustained_freshness|recovery)$/.exec(key);
  if (!match || match[1] !== component || kind && match[4] !== kind
      || incidentId !== undefined && Number(match[2]) !== incidentId) throw new TypeError('Invalid notice identity');
  instant(Number(match[2])); instant(Number(match[3]));
}

// Restrict persisted state to the accepted reducer's bounded, allowlisted shape.
export function durableState(value) {
  if (!keys(value, 'version,observedAt,fingerprint,conflicted,samples,acknowledged,cooldowns')
      || value.version !== noticePolicy.version || typeof value.conflicted !== 'boolean'
      || !value.samples || typeof value.samples !== 'object' || Array.isArray(value.samples)
      || !value.cooldowns || typeof value.cooldowns !== 'object' || Array.isArray(value.cooldowns)
      || !Array.isArray(value.acknowledged) || value.acknowledged.length > noticePolicy.maxAcknowledgements)
    throw new TypeError('Invalid durable notice state');
  if (value.observedAt !== null) instant(value.observedAt);
  if (value.fingerprint !== null) {
    const input = JSON.parse(value.fingerprint);
    const projected = noticeInput({lastCheckedAt: input.checkedAt, historyComplete: true,
      components: input.components, recentIncidents: input.incidents}, input.checkedAt);
    if (JSON.stringify(projected) !== value.fingerprint || input.checkedAt !== value.observedAt)
      throw new TypeError('Noncanonical notice fingerprint');
  } else if (value.observedAt !== null) throw new TypeError('Missing notice fingerprint');
  for (const [id, sample] of Object.entries(value.samples)) {
    if (!Object.hasOwn(componentNames, id) || !keys(sample, 'key,firstAt,lastAt,count')
        || !Number.isSafeInteger(sample.count) || sample.count < 1 || sample.count > 1000)
      throw new TypeError('Invalid durable sample');
    if (sample.key !== 'healthy') identity(sample.key, id);
    if (instant(sample.firstAt) > instant(sample.lastAt)) throw new TypeError('Invalid sample interval');
  }
  const seen = new Set();
  for (const ack of value.acknowledged) {
    if (!keys(ack, 'key,component,incidentId,kind,evidenceAt') || seen.has(ack.key)
        || !['outage', 'sustained_freshness', 'recovery'].includes(ack.kind)
        || !Number.isSafeInteger(ack.incidentId) || ack.incidentId < 1)
      throw new TypeError('Invalid durable acknowledgement');
    identity(ack.key, ack.component, ack.kind, ack.incidentId); instant(ack.evidenceAt); seen.add(ack.key);
  }
  for (const [key, at] of Object.entries(value.cooldowns)) {
    if (!Object.keys(componentNames).some(id => key === `${id}:outage` || key === `${id}:sustained_freshness`))
      throw new TypeError('Invalid durable cooldown');
    instant(at);
  }
  return value;
}
