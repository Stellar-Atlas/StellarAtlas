import { emptyNoticeState } from './notice-dry-run.mjs';
import { componentNames, instant, noticeKey, noticePolicy, renderNotice } from './notice-input.mjs';
import { durableState } from './notice-durable-state.mjs';

const FENCE = `EXISTS (SELECT 1 FROM notice_control WHERE id = 1 AND enabled = 1
  AND lease_token = ? AND generation = ? AND lease_until > ? AND last_at <= ?)`;
const LIMIT = 9007199254740991;
const changed = result => Number(result?.meta?.changes ?? 0) > 0;
const rows = result => result?.results ?? [];
function encode(value, max) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > max) throw new RangeError('Notice storage bound exceeded');
  return text;
}
function duration(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) throw new TypeError('Invalid notice duration');
  return value;
}
function publicNotice(notice) {
  if (!notice || !Object.hasOwn(componentNames, notice.component)
      || !['outage', 'sustained_freshness', 'recovery'].includes(notice.kind)
      || !Number.isSafeInteger(notice.incidentId) || notice.incidentId < 1
      || !Array.isArray(notice.recovers) || notice.recovers.length > 2
      || new Set(notice.recovers).size !== notice.recovers.length
      || (notice.kind === 'recovery' ? notice.recovers.length === 0 : notice.recovers.length !== 0)
      || notice.recovers.some(kind => !['outage', 'sustained_freshness'].includes(kind)))
    throw new TypeError('Invalid public notice');
  const parse = value => {
    const at = instant(Date.parse(value));
    if (new Date(at).toISOString() !== value) throw new TypeError('Invalid public sampled time');
    return at;
  };
  const incident = {component: notice.component, id: notice.incidentId,
    startedAt: parse(notice.evidence.sampledStartAt),
    endedAt: notice.evidence.sampledRecoveryAt === null ? null : parse(notice.evidence.sampledRecoveryAt)};
  const sample = {firstAt: parse(notice.evidence.confirmationStartedAt), lastAt: parse(notice.evidence.confirmedAt)};
  if (notice.key !== noticeKey(incident, notice.kind) || sample.firstAt > sample.lastAt
      || incident.startedAt > sample.firstAt
      || (notice.kind === 'recovery' ? incident.endedAt === null || incident.endedAt > sample.firstAt : incident.endedAt !== null)
      || JSON.stringify(notice) !== JSON.stringify(renderNotice(incident, notice.kind, sample, notice.recovers)))
    throw new TypeError('Noncanonical public projection');
  return encode(notice, 4096);
}

// D1 prepare/bind/all/run/batch only; never creates a schema or invokes transport.
export class NoticeDeliveryStore {
  constructor(db, clock) { this.db = db; this.clock = clock; }
  at() { return instant(this.clock()); }
  fence(lease, at) { return [lease.token, lease.generation, at, at]; }
  statement(sql, args) { return this.db.prepare(sql).bind(...args); }
  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Boolean enablement required');
    const at = this.at();
    const result = await this.statement(`UPDATE notice_control SET enabled = ?,
      generation = generation + 1, lease_token = NULL, lease_until = 0, last_at = ?
      WHERE id = 1 AND last_at <= ? AND generation < ?`, [Number(enabled), at, at, LIMIT]).run();
    if (!changed(result)) throw new Error('Notice control unavailable or clock regressed');
  }
  async acquire(token, leaseMs = 30_000) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) throw new TypeError('Opaque 128-bit owner token required');
    const at = this.at(), until = instant(at + duration(leaseMs));
    const result = await this.statement(`UPDATE notice_control SET generation = generation + 1,
      lease_token = ?, lease_until = ?, last_at = ? WHERE id = 1 AND enabled = 1
      AND lease_until <= ? AND last_at <= ? AND generation < ? RETURNING generation`,
      [token, until, at, at, at, LIMIT]).all();
    const row = rows(result)[0];
    return row ? {token, generation: row.generation, until} : null;
  }
  async release(lease) {
    const at = this.at();
    return changed(await this.statement(`UPDATE notice_control SET lease_until = 0, lease_token = NULL,
      last_at = ? WHERE id = 1 AND ${FENCE}`, [at, ...this.fence(lease, at)]).run());
  }
  async load(lease) {
    const at = this.at(), args = this.fence(lease, at);
    // Any previous generation may have sent. Expiry is never proof of rejection.
    await this.statement(`UPDATE notice_delivery SET state = 'uncertain', outcome = 'unknown', updated_at = ?
      WHERE state = 'sending' AND attempt_generation <> ? AND ${FENCE}`,
      [at, lease.generation, ...args]).run();
    const row = rows(await this.statement(`SELECT state_json FROM notice_control WHERE id = 1 AND ${FENCE}`, args).all())[0];
    if (!row) throw new Error('Stale notice owner');
    return row.state_json === null ? emptyNoticeState() : durableState(JSON.parse(row.state_json));
  }
  async stage(lease, state, proposals) {
    if (!Array.isArray(proposals) || proposals.length > 3) throw new RangeError('Notice proposal bound exceeded');
    const at = this.at(), args = this.fence(lease, at);
    const statements = [this.statement(`UPDATE notice_control SET state_json = ?, last_at = ?
      WHERE id = 1 AND ${FENCE}`, [encode(durableState(state), 1_048_576), at, ...args])];
    for (const notice of proposals) statements.push(this.statement(`INSERT INTO notice_delivery
      (notice_key, payload_json, state, updated_at) SELECT ?, ?, 'ready', ? WHERE ${FENCE}
      ON CONFLICT(notice_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
      WHERE notice_delivery.state = 'ready'`, [notice.key, publicNotice(notice), at, ...args]));
    const results = await this.db.batch(statements);
    if (!changed(results[0])) throw new Error('Stale notice owner');
  }
  async start(lease, key) {
    const at = this.at();
    const row = rows(await this.statement(`UPDATE notice_delivery SET state = 'sending',
      attempt_generation = ?, attempts = attempts + 1, updated_at = ? WHERE notice_key = ?
      AND state = 'ready' AND not_before <= ? AND attempts < 1000 AND ${FENCE}
      AND (SELECT next_allowed_at FROM notice_control WHERE id = 1) <= ? RETURNING payload_json`,
      [lease.generation, at, key, at, ...this.fence(lease, at), at]).all())[0];
    return row ? JSON.parse(row.payload_json) : null;
  }
  owned(lease, key, at) {
    return {sql: `notice_key = ? AND state = 'sending' AND attempt_generation = ? AND ${FENCE}`,
      args: [key, lease.generation, ...this.fence(lease, at)]};
  }
  async accept(lease, key) {
    const state = await this.load(lease), at = this.at(), owned = this.owned(lease, key, at);
    const row = rows(await this.statement(`SELECT payload_json FROM notice_delivery WHERE ${owned.sql}`, owned.args).all())[0];
    if (!row) throw new Error('Stale notice acknowledgement');
    const notice = JSON.parse(row.payload_json);
    if (state.acknowledged.length >= noticePolicy.maxAcknowledgements) throw new RangeError('Acknowledgement bound exceeded');
    const evidenceAt = Date.parse(notice.evidence.confirmedAt);
    state.acknowledged.push({key: notice.key, component: notice.component, incidentId: notice.incidentId,
      kind: notice.kind, evidenceAt});
    if (notice.kind !== 'recovery') state.cooldowns[`${notice.component}:${notice.kind}`] = evidenceAt;
    const results = await this.db.batch([
      this.statement(`UPDATE notice_control SET state_json = ?, last_at = ? WHERE id = 1
        AND EXISTS (SELECT 1 FROM notice_delivery WHERE ${owned.sql})`,
        [encode(state, 1_048_576), at, ...owned.args]),
      this.statement(`UPDATE notice_delivery SET state = 'acknowledged', outcome = 'accepted', updated_at = ?
        WHERE ${owned.sql}`, [at, ...owned.args]),
    ]);
    if (!changed(results[0]) || !changed(results[1])) throw new Error('Stale notice acknowledgement');
  }
  async reject(lease, key, retryAfterMs, rateLimited = false) {
    const at = this.at(), until = instant(at + duration(retryAfterMs)), owned = this.owned(lease, key, at);
    const results = await this.db.batch([
      this.statement(`UPDATE notice_control SET next_allowed_at = max(next_allowed_at, ?), last_at = ?
        WHERE id = 1 AND EXISTS (SELECT 1 FROM notice_delivery WHERE ${owned.sql})`,
        [rateLimited ? until : 0, at, ...owned.args]),
      this.statement(`UPDATE notice_delivery SET state = 'ready', outcome = ?, not_before = ?, updated_at = ?
        WHERE ${owned.sql}`, [rateLimited ? 'rate_limited' : 'not_accepted', until, at, ...owned.args]),
    ]);
    if (!changed(results[0]) || !changed(results[1])) throw new Error('Stale notice rejection');
  }
  async uncertain(lease, key) {
    const at = this.at(), owned = this.owned(lease, key, at);
    return changed(await this.statement(`UPDATE notice_delivery SET state = 'uncertain', outcome = 'unknown',
      updated_at = ? WHERE ${owned.sql}`, [at, ...owned.args]).run());
  }
}
