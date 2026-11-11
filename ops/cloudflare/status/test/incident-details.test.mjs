import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { acquireLease, commitCheck, readStatus, annotateIncident } from '../lib/store.mjs';

class D1 {
  raw = new DatabaseSync(':memory:');
  lastBatch = [];
  constructor() { this.raw.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql) {
    const raw = this.raw;
    return { sql, args: [], bind(...args) { this.args = args; return this; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...this.args).changes) } }; },
      async all() { return { results: raw.prepare(sql).all(...this.args) }; } };
  }
  async batch(statements) {
    this.lastBatch = statements.map(statement => statement.sql);
    this.raw.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(/^\s*SELECT/.test(statement.sql) ? await statement.all() : await statement.run());
      this.raw.exec('COMMIT'); return results;
    } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}
async function migrate(db, file) {
  db.raw.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
}
async function fixture() {
  const db = new D1();
  await migrate(db, '0001_status.sql'); await migrate(db, '0002_incident_details.sql');
  return db;
}
const NOW = Date.parse('2026-11-01T04:00:00.789Z');
const observations = primary => [
  { id: 'primary', state: 'operational', reasonCode: 'ok', ...primary },
  { id: 'data', state: 'operational', reasonCode: 'ok' },
  { id: 'failover', state: 'operational', reasonCode: 'ok' },
];
async function check(db, primary, now, token) {
  assert.equal(await acquireLease(db, now, token), true);
  return commitCheck(db, observations(primary), now, token);
}

test('migration adds nullable details without rewriting prior intervals or reasons', async () => {
  const db = new D1(); await migrate(db, '0001_status.sql');
  db.raw.exec(`INSERT INTO outages(id,component,started_at,ended_at,reason_code,source,confidence,evidence_key)
    VALUES (7,'data',1234,4567,'data_unavailable','cloudflare-inferred','inferred','old-evidence')`);
  db.raw.exec("INSERT INTO service_state VALUES ('data','unknown','monitor_unavailable',1234,1234,NULL)");
  const before = { ...db.raw.prepare('SELECT * FROM outages WHERE id=7').get() };
  const serviceBefore = { ...db.raw.prepare("SELECT * FROM service_state WHERE id='data'").get() };
  await migrate(db, '0002_incident_details.sql');
  assert.deepEqual({ ...db.raw.prepare('SELECT * FROM outages WHERE id=7').get() }, { ...before, probe_detail: null });
  assert.deepEqual({ ...db.raw.prepare("SELECT * FROM service_state WHERE id='data'").get() }, { ...serviceBefore, probe_detail: null });
  assert.throws(() => db.raw.exec("INSERT INTO outages(component,started_at,reason_code) VALUES ('data',9,'power_failure')"), /CHECK/);
  assert.throws(() => db.raw.exec("INSERT INTO incident_annotations VALUES(999,'unknown','Unknown',NULL,10)"), /FOREIGN KEY/);
  assert.throws(() => db.raw.exec("INSERT INTO incident_annotations VALUES(7,'unsupported','Unknown',NULL,10)"), /CHECK/);
  assert.throws(() => db.raw.prepare('INSERT INTO incident_annotations VALUES(7,?,?,NULL,10)').run('unknown', 'x'.repeat(241)), /CHECK/);
});

test('observed milliseconds drive incident/service times while control and lease use commit time', async () => {
  const db = await fixture(); const opened = NOW - 50123;
  const detail = { kind: 'http', httpStatus: 503 };
  assert.equal(await check(db, { state: 'degraded', reasonCode: 'origin_unavailable', observedAt: opened, probeDetail: detail }, NOW, 'open'), true);
  let status = await readStatus(db, NOW);
  assert.equal(db.lastBatch.length, 3); assert.match(db.lastBatch[2], /LEFT JOIN incident_annotations/);
  assert.equal(status.lastCheckedAt, NOW);
  assert.equal(status.components[0].checkedAt, opened); assert.equal(status.components[0].changedAt, opened);
  assert.equal(status.components[1].checkedAt, NOW);
  assert.equal(status.recentIncidents[0].startedAt, opened);
  assert.deepEqual(status.recentIncidents[0].probeDetail, detail);
  assert.equal(await check(db, { state: 'degraded', reasonCode: 'origin_unavailable', observedAt: NOW + 59123, probeDetail: { kind: 'timeout' } }, NOW + 60000, 'still'), true);
  status = await readStatus(db, NOW + 60000);
  assert.deepEqual(status.components[0].probeDetail, { kind: 'timeout' });
  assert.deepEqual(status.recentIncidents[0].probeDetail, detail); // Opening evidence is retained.
  const ended = NOW + 102997;
  assert.equal(await check(db, { observedAt: ended }, NOW + 120000, 'close'), true);
  status = await readStatus(db, NOW + 120000);
  assert.equal(status.recentIncidents[0].endedAt, ended);
  assert.equal(status.components[0].checkedAt, ended); assert.equal(status.components[0].changedAt, ended);
  assert.equal(status.components[0].probeDetail, null);
  assert.equal(status.lastCheckedAt, NOW + 120000);

  const expired = await fixture();
  assert.equal(await acquireLease(expired, NOW - 1000, 'expired', 500), true);
  assert.equal(await commitCheck(expired, observations({ observedAt: NOW - 90000 }), NOW, 'expired'), false);
  assert.equal(expired.raw.prepare('SELECT count(*) AS n FROM service_state').get().n, 0);
});

test('invalid observation times and unsafe probe JSON fail before any check writes', async () => {
  const db = await fixture(); await acquireLease(db, NOW, 'validate');
  for (const observedAt of [NOW - 90001, NOW + 1, NOW + 0.5, NaN, null, String(NOW), Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(commitCheck(db, observations({ observedAt }), NOW, 'validate'), /timestamp|window/);
  }
  for (const probeDetail of [
    '{}', [], { kind: 'http', body: 'private body' }, { kind: 'http', headers: {} },
    { kind: 'http', url: 'https://internal.example' }, { kind: 'http', message: 'secret' },
    { kind: 'http', httpStatus: 99 }, { kind: 'http', httpStatus: 600 },
    { kind: 'http', httpStatus: 200.5 }, { kind: 'response', check: 'database' },
    { kind: 'response', status: 'failed' }, { kind: 'response', ageSeconds: -1 },
    { kind: 'response', ageSeconds: 864001 }, { kind: 'response', ageSeconds: 1.1 },
    JSON.parse('{"kind":"http","__proto__":{"body":"secret"}}'),
  ]) await assert.rejects(commitCheck(db, observations({ probeDetail }), NOW, 'validate'), /probe/);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM service_state').get().n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM outages').get().n, 0);
  const safe = { kind: 'readiness', check: 'publication', status: 'incomplete', ageSeconds: 864000, httpStatus: 599 };
  assert.equal(await commitCheck(db, observations({ observedAt: NOW - 90000, probeDetail: safe }), NOW, 'validate'), true);
  assert.deepEqual((await readStatus(db, NOW)).components[0].probeDetail, safe);
});

test('annotation upsert preserves the outage row and never returns private evidence', async () => {
  const db = await fixture(); await check(db, { state: 'degraded', reasonCode: 'origin_unavailable', probeDetail: { kind: 'timeout' } }, NOW, 'down');
  const before = { ...db.raw.prepare('SELECT * FROM outages').get() };
  const value = { incidentId: before.id, causeCode: 'server_restart', publicSummary: 'Service restarted.', evidenceRef: 'private:reviewed-evidence/001' };
  assert.equal(await annotateIncident(db, value, NOW + 1234), true);
  assert.equal(await annotateIncident(db, { ...value, publicSummary: 'Restart confirmed after review.' }, NOW + 2345), true);
  assert.equal(await annotateIncident(db, { ...value, incidentId: 9999 }, NOW + 2345), false);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM incident_annotations').get().n, 1);
  assert.deepEqual({ ...db.raw.prepare('SELECT * FROM outages').get() }, before);
  const status = await readStatus(db, NOW + 3000);
  assert.equal(db.lastBatch.length, 3);
  assert.deepEqual(status.recentIncidents[0].cause, { code: 'server_restart', summary: 'Restart confirmed after review.', annotatedAt: NOW + 2345 });
  assert.doesNotMatch(JSON.stringify(status), /evidence_ref|evidenceRef|private:reviewed-evidence/);
  assert.equal(db.raw.prepare('SELECT evidence_ref FROM incident_annotations').get().evidence_ref, value.evidenceRef);
  await check(db, {}, NOW + 60000, 'restored');
  await check(db, { state: 'degraded', reasonCode: 'origin_unavailable' }, NOW + 120000, 'later');
  const later = await readStatus(db, NOW + 120000);
  assert.equal(later.recentIncidents.length, 2);
  assert.equal(later.recentIncidents.find(row => row.id === before.id).cause.code, 'server_restart');
  assert.equal(later.recentIncidents.find(row => row.id !== before.id).cause, null);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM incident_annotations').get().n, 1);
  for (const invalid of [
    { ...value, incidentId: 0 }, { ...value, causeCode: 'maybe_reboot' },
    { ...value, publicSummary: 'x'.repeat(241) }, { ...value, publicSummary: 'unsafe\nsummary' },
    { ...value, evidenceRef: {} }, { ...value, evidenceRef: 'private\nlog' },
    { ...value, extra: 'unexpected' },
  ]) await assert.rejects(annotateIncident(db, invalid, NOW), /annotation|summary|reference/);
  await assert.rejects(annotateIncident(db, value, 1.5), /timestamp/);
  db.raw.prepare('UPDATE service_state SET probe_detail=? WHERE id=\'primary\'').run('{"kind":"http","body":"secret"}');
  assert.equal((await readStatus(db, NOW)).components[0].probeDetail, null);
});
