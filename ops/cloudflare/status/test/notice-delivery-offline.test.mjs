import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './notice-fixture.mjs';
import { persistentFixture } from './notice-sql-fixture.mjs';
import { evaluateOfflineDelivery, OfflineNoticeTransport } from '../lib/notice-delivery-offline.mjs';

const token = 'c'.repeat(32);
async function environment(t, transport = new OfflineNoticeTransport()) {
  const monitor = await fixture(t), f = persistentFixture(t); f.now = monitor.now;
  await f.store.setEnabled(true);
  f.evaluate = async () => evaluateOfflineDelivery(f.store, await monitor.snapshot(), token, transport);
  f.observe = async (ms = 0) => {
    if (ms) monitor.tick(ms);
    await monitor.observe(); f.now = monitor.now; return f.evaluate();
  };
  return Object.assign(f, {monitor, transport});
}
const rows = f => f.db.raw.prepare('SELECT * FROM notice_delivery ORDER BY notice_key').all();
async function outage(f) { f.monitor.primary = false; await f.observe(); return f.observe(60_000); }

test('partial confirmation survives file reload and success remains deduplicated on restart', async t => {
  const f = await environment(t); f.monitor.primary = false; await f.observe();
  assert.equal(f.transport.captures.length, 0);
  f.close(f.db); Object.assign(f, f.open());
  assert.equal((await f.observe(60_000)).deliveries[0].status, 'acknowledged');
  f.close(f.db); Object.assign(f, f.open());
  await f.evaluate(); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 1); assert.equal(rows(f)[0].state, 'acknowledged');
});

test('explicit not-accepted failure retries only after its persisted deadline', async t => {
  const f = await environment(t, new OfflineNoticeTransport({status: 'not_accepted', retryAfterMs: 60_000}));
  assert.equal((await outage(f)).deliveries[0].status, 'not_accepted');
  assert.equal(rows(f)[0].outcome, 'not_accepted');
  f.close(f.db); Object.assign(f, f.open());
  f.transport.outcome = {status: 'accepted'}; await f.evaluate();
  assert.equal(f.transport.captures.length, 1);
  assert.equal((await f.observe(60_000)).deliveries[0].status, 'acknowledged');
  assert.equal(f.transport.captures.length, 2); assert.equal(rows(f)[0].attempts, 2);
});

test('provider rate limit gates other notices and survives restart', async t => {
  const f = await environment(t, new OfflineNoticeTransport({status: 'rate_limited', retryAfterMs: 120_000}));
  await outage(f); assert.equal(rows(f)[0].outcome, 'rate_limited');
  f.close(f.db); Object.assign(f, f.open()); f.transport.outcome = {status: 'accepted'};
  f.monitor.fallback = false; await f.observe(60_000);
  assert.equal(f.transport.captures.length, 1);
  await f.observe(60_000);
  assert.equal(f.transport.captures.length, 3);
  assert.ok(rows(f).every(row => row.state === 'acknowledged'));
});

test('acceptance followed by lost response remains uncertain and never blindly resends', async t => {
  class LostResponse extends OfflineNoticeTransport {
    async send(notice) { await super.send(notice); throw new Error('Provider response lost: private diagnostics'); }
  }
  const f = await environment(t, new LostResponse());
  assert.equal((await outage(f)).deliveries[0].status, 'uncertain');
  f.close(f.db); Object.assign(f, f.open()); await f.evaluate(); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 1); assert.equal(rows(f)[0].state, 'uncertain');
  assert.ok(!JSON.stringify(rows(f)).includes('private diagnostics'));
  f.monitor.primary = true; await f.observe(60_000); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 1, 'uncertain problems cannot bootstrap orphan recovery');
});

test('lost SQL result after committed acknowledgement is conservatively reported but never repeated', async t => {
  const f = await environment(t), batch = f.db.batch.bind(f.db);
  f.db.batch = async statements => {
    const result = await batch(statements);
    if (statements.some(item => item.sql.includes("state = 'acknowledged'"))) throw new Error('SQL response lost after commit');
    return result;
  };
  assert.equal((await outage(f)).deliveries[0].status, 'uncertain');
  f.db.batch = batch; assert.equal(rows(f)[0].state, 'acknowledged');
  f.close(f.db); Object.assign(f, f.open()); await f.evaluate();
  assert.equal(f.transport.captures.length, 1);
});

test('SQL failure before acknowledgement commit leaves a non-retryable uncertain send', async t => {
  const f = await environment(t), batch = f.db.batch.bind(f.db);
  f.db.batch = statements => statements.some(item => item.sql.includes("state = 'acknowledged'"))
    ? Promise.reject(new Error('SQL unavailable before commit')) : batch(statements);
  await outage(f); assert.equal(rows(f)[0].state, 'uncertain');
  f.db.batch = batch; await f.observe(60_000); assert.equal(f.transport.captures.length, 1);
});

test('expired ownership during fake acceptance prevents acknowledgement by the old owner', async t => {
  const f = await environment(t);
  f.transport.send = async notice => { f.transport.captures.push(notice); f.now += 30_000; return {status: 'accepted'}; };
  await outage(f); assert.equal(rows(f)[0].state, 'sending');
  f.now = f.monitor.now + 30_000; const lease = await f.store.acquire('d'.repeat(32));
  const state = await f.store.load(lease);
  assert.equal(state.acknowledged.length, 0); assert.equal(rows(f)[0].state, 'uncertain');
});

test('disablement fences in-flight acknowledgement and blocks fresh transport invocation', async t => {
  const f = await environment(t);
  f.transport.send = async notice => {
    f.transport.captures.push(notice); await f.store.setEnabled(false); return {status: 'accepted'};
  };
  await outage(f); assert.equal(rows(f)[0].state, 'sending');
  assert.equal((await f.evaluate()).status, 'disabled_or_busy');
  await f.store.setEnabled(true);
  const lease = await f.store.acquire('d'.repeat(32)); await f.store.load(lease); await f.store.release(lease);
  assert.equal(rows(f)[0].state, 'uncertain'); await f.evaluate();
  assert.equal(f.transport.captures.length, 1);
});

test('unrecognized or malformed provider outcomes cannot unlock retry', async t => {
  for (const outcome of [undefined, {status: 'failed'}, {status: 'not_accepted', retryAfterMs: 0},
    {status: 'rate_limited', retryAfterMs: 3_600_001}]) {
    const f = await environment(t, new OfflineNoticeTransport(outcome));
    // Explicit undefined is injected after construction (the default otherwise means fake acceptance).
    f.transport.outcome = outcome; await outage(f); await f.evaluate();
    assert.equal(rows(f)[0].state, 'uncertain'); assert.equal(f.transport.captures.length, 1);
  }
});

test('recovery needs acknowledged problem, preserves approved text and is deduplicated after reload', async t => {
  const f = await environment(t); await outage(f);
  f.monitor.primary = true; await f.observe(60_000); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 2); assert.equal(f.transport.captures[1].kind, 'recovery');
  assert.deepEqual(f.transport.captures[1].recovers, ['outage']);
  assert.match(f.transport.captures[1].text, /Recovery observed .*; confirmed /);
  assert.equal(f.transport.captures[1].statusUrl, 'https://status.stellaratlas.io/');
  f.close(f.db); Object.assign(f, f.open()); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 2);
});

test('acknowledged cooldown survives restart and equality remains suppressed', async t => {
  const f = await environment(t); await outage(f);
  const acknowledgedAt = f.now;
  f.monitor.primary = true; await f.observe(60_000); await f.observe(60_000);
  f.close(f.db); Object.assign(f, f.open());
  f.monitor.primary = false; await f.observe(60_000); await f.observe(60_000);
  while (f.now < acknowledgedAt + 900_000) await f.observe(Math.min(60_000, acknowledgedAt + 900_000 - f.now));
  assert.equal(f.transport.captures.length, 2);
  await f.observe(60_000); assert.equal(f.transport.captures.length, 3);
});

test('sustained freshness keeps the five-minute confirmation window through reload', async t => {
  const f = await environment(t); f.monitor.data = 'stale'; await f.observe();
  for (let i = 0; i < 4; i++) await f.observe(60_000);
  assert.equal(f.transport.captures.length, 0); f.close(f.db); Object.assign(f, f.open());
  await f.observe(60_000);
  assert.equal(f.transport.captures[0].kind, 'sustained_freshness');
  assert.match(f.transport.captures[0].text, /sustained freshness delay/);
});

test('obsolete explicit failures do not send later when the current evidence has recovered', async t => {
  const f = await environment(t, new OfflineNoticeTransport({status: 'not_accepted', retryAfterMs: 60_000}));
  await outage(f); f.monitor.primary = true;
  await f.observe(60_000); await f.observe(60_000);
  assert.equal(f.transport.captures.length, 1); assert.equal(rows(f)[0].state, 'ready');
});

test('only explicit offline fake transport is accepted and disabled execution does not evaluate', async t => {
  const f = persistentFixture(t);
  assert.equal((await evaluateOfflineDelivery(f.store, null, token, new OfflineNoticeTransport())).status, 'disabled_or_busy');
  await assert.rejects(evaluateOfflineDelivery(f.store, null, token, {send() { throw Error('real transport'); }}), /fake/);
});

test('overlapping evaluations do not resend an in-flight identity, including after lease expiry', async t => {
  const f = await environment(t); f.monitor.primary = false; await f.observe();
  let accepted, started;
  const began = new Promise(resolve => { started = resolve; });
  f.transport.send = notice => {
    f.transport.captures.push(notice); started();
    return new Promise(resolve => { accepted = resolve; });
  };
  f.monitor.tick(); await f.monitor.observe(); f.now = f.monitor.now;
  const first = f.evaluate(); await began;
  assert.equal((await f.evaluate()).status, 'disabled_or_busy');
  f.now += 30_000;
  const second = await evaluateOfflineDelivery(f.store, await f.monitor.snapshot(), 'f'.repeat(32), f.transport);
  assert.equal(second.deliveries[0].status, 'blocked');
  accepted({status: 'accepted'}); assert.equal((await first).deliveries[0].status, 'uncertain');
  assert.equal(rows(f)[0].state, 'uncertain'); assert.equal(f.transport.captures.length, 1);
});

test('staging failure invokes no transport and retries without manufacturing confirmation', async t => {
  const f = await environment(t); f.monitor.primary = false; await f.observe();
  f.monitor.tick(); await f.monitor.observe(); f.now = f.monitor.now;
  const before = f.db.raw.prepare('SELECT state_json FROM notice_control').get().state_json;
  const batch = f.db.batch.bind(f.db);
  f.db.batch = () => Promise.reject(new Error('Staging transaction unavailable'));
  await assert.rejects(f.evaluate(), /Staging/);
  assert.equal(f.transport.captures.length, 0); assert.equal(rows(f).length, 0);
  assert.equal(f.db.raw.prepare('SELECT state_json FROM notice_control').get().state_json, before);
  f.db.batch = batch; await f.evaluate();
  assert.equal(f.transport.captures.length, 1);
});

test('private snapshot extras never enter reducer fingerprint or public payload storage', async t => {
  const f = await environment(t); f.monitor.primary = false; await f.observe();
  f.monitor.tick(); await f.monitor.observe(); f.now = f.monitor.now;
  const status = await f.monitor.snapshot(); status.rawProbeText = 'PRIVATE_SENTINEL';
  status.recentIncidents[0].evidenceRef = 'PRIVATE_SENTINEL';
  status.components[0].credentials = 'PRIVATE_SENTINEL';
  await evaluateOfflineDelivery(f.store, status, token, f.transport);
  const stored = JSON.stringify({rows: rows(f), control: f.db.raw.prepare('SELECT state_json FROM notice_control').get()});
  assert.ok(!stored.includes('PRIVATE_SENTINEL')); assert.equal(f.transport.captures.length, 1);
});
