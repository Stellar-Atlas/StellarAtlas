import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { SqlD1, migrate, persistentFixture } from './notice-sql-fixture.mjs';
import { fixture } from './notice-fixture.mjs';
import { emptyNoticeState } from '../lib/notice-dry-run.mjs';

const token = 'a'.repeat(32), other = 'b'.repeat(32);
const record = f => f.db.raw.prepare('SELECT * FROM notice_delivery').get();
async function staged(t) {
  const monitor = await fixture(t); await monitor.outage();
  const f = persistentFixture(t); f.now = monitor.now;
  await f.store.setEnabled(true); const lease = await f.store.acquire(token);
  const notice = monitor.sink.captures[0];
  await f.store.stage(lease, emptyNoticeState(), [notice]);
  return Object.assign(f, {notice, lease});
}

test('proposed upgrade preserves the original schema data and is disabled by default', async t => {
  const db = new SqlD1(); t.after(() => db.raw.close());
  migrate(db, ['0001_status.sql', '0002_incident_details.sql']);
  db.raw.exec("INSERT INTO outages(component,started_at,reason_code) VALUES('primary',123,'origin_unavailable')");
  const before = db.raw.prepare('SELECT * FROM outages').all();
  const schema = db.raw.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  migrate(db, ['notice-delivery-schema.sql']);
  assert.deepEqual(db.raw.prepare('SELECT * FROM outages').all(), before);
  for (const item of schema) assert.equal(db.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(item.name).sql, item.sql);
  assert.equal(db.raw.prepare('SELECT enabled,schema_version FROM notice_control').get().enabled, 0);
  assert.equal(db.raw.prepare('SELECT schema_version FROM notice_control').get().schema_version, 1);
});

test('disabled state grants no owner; invalid owner tokens and durations fail', async t => {
  const f = persistentFixture(t);
  assert.equal(await f.store.acquire(token), null);
  await assert.rejects(f.store.acquire('raw-provider-token'), /128-bit/);
  await assert.rejects(f.store.acquire(token, 0), /duration/);
  await assert.rejects(f.store.setEnabled('yes'), /Boolean/);
});

test('four concurrent SQL connections elect exactly one fenced owner', async t => {
  const f = persistentFixture(t); await f.store.setEnabled(true);
  const workers = Array.from({length: 4}, (_, i) => new Worker(new URL('./notice-claim-worker.mjs', import.meta.url),
    {workerData: {file: f.file, now: f.now, token: String(i + 1).repeat(32)}}));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  await Promise.all(workers.map(worker => once(worker, 'message')));
  const exits = workers.map(worker => once(worker, 'exit'));
  const answers = workers.map(worker => once(worker, 'message'));
  for (const worker of workers) worker.postMessage('claim');
  const results = (await Promise.all(answers)).map(([answer]) => answer);
  assert.equal(results.filter(item => item.lease).length, 1);
  assert.equal(results.filter(item => item.error).length, 0);
  assert.ok((await Promise.all(exits)).every(([code]) => code === 0));
});

test('a new generation fences even a reused owner token after expiry', async t => {
  const f = await staged(t); await f.store.start(f.lease, f.notice.key);
  f.now = f.lease.until;
  const lease = await f.store.acquire(token); assert.ok(lease.generation > f.lease.generation);
  await f.store.load(lease);
  await assert.rejects(f.store.stage(f.lease, emptyNoticeState(), []), /Stale/);
  assert.equal(await f.store.start(f.lease, f.notice.key), null);
  await assert.rejects(f.store.accept(f.lease, f.notice.key), /Stale/);
  await assert.rejects(f.store.reject(f.lease, f.notice.key, 1000), /Stale/);
  assert.equal(await f.store.uncertain(f.lease, f.notice.key), false);
  assert.equal(await f.store.release(f.lease), false);
  assert.equal(record(f).state, 'uncertain');
});

test('an expired owner cannot start or acknowledge even without a successor', async t => {
  const f = await staged(t); f.now = f.lease.until;
  assert.equal(await f.store.start(f.lease, f.notice.key), null);
  await assert.rejects(f.store.accept(f.lease, f.notice.key), /Stale/);
  assert.equal(record(f).state, 'ready');
});

test('restart before send retains intent and allows a fresh owner to send', async t => {
  const f = await staged(t); f.close(f.db); f.now = f.lease.until;
  Object.assign(f, f.open()); const lease = await f.store.acquire(other);
  await f.store.load(lease);
  assert.deepEqual(await f.store.start(lease, f.notice.key), f.notice);
  await f.store.accept(lease, f.notice.key);
  assert.equal(record(f).state, 'acknowledged');
  await f.store.release(lease); f.close(f.db); Object.assign(f, f.open());
  const next = await f.store.acquire(token), state = await f.store.load(next);
  assert.equal(state.acknowledged[0].key, f.notice.key);
  assert.equal(state.cooldowns['primary:outage'], Date.parse(f.notice.evidence.confirmedAt));
  assert.equal(await f.store.start(next, f.notice.key), null);
});

test('restart after send intent, including death before actual invocation, becomes uncertain', async t => {
  const f = await staged(t); await f.store.start(f.lease, f.notice.key);
  f.close(f.db); f.now = f.lease.until; Object.assign(f, f.open());
  const next = await f.store.acquire(other), state = await f.store.load(next);
  assert.equal(record(f).state, 'uncertain'); assert.equal(state.acknowledged.length, 0);
  assert.equal(await f.store.start(next, f.notice.key), null);
});

test('acknowledgement and reducer state roll back together on SQL failure', async t => {
  const f = await staged(t); await f.store.start(f.lease, f.notice.key);
  const batch = f.db.batch.bind(f.db);
  f.db.batch = statements => batch([...statements, f.db.prepare('INSERT INTO missing_table VALUES (1)')]);
  await assert.rejects(f.store.accept(f.lease, f.notice.key), /missing_table/);
  f.db.batch = batch;
  assert.equal(record(f).state, 'sending');
  assert.equal((await f.store.load(f.lease)).acknowledged.length, 0);
  await f.store.accept(f.lease, f.notice.key);
  assert.equal(record(f).state, 'acknowledged');
});

test('capacity fails closed without deleting active, acknowledged or uncertain evidence', async t => {
  const f = await staged(t); await f.store.start(f.lease, f.notice.key);
  await f.store.uncertain(f.lease, f.notice.key);
  const insert = f.db.raw.prepare(`INSERT INTO notice_delivery(notice_key,payload_json,state,updated_at)
    VALUES(?,'{}',?,0)`);
  f.db.raw.exec('BEGIN IMMEDIATE');
  for (let i = 1; i < 2000; i++) insert.run('retained-' + i, i % 2 ? 'acknowledged' : 'ready');
  f.db.raw.exec('COMMIT');
  const before = f.db.raw.prepare('SELECT state_json FROM notice_control').get().state_json;
  // A canonical second identity, generated through the actual accepted projection.
  const {renderNotice} = await import('../lib/notice-input.mjs');
  const notice = renderNotice({component: 'primary', id: f.notice.incidentId + 1,
    startedAt: Date.parse(f.notice.evidence.sampledStartAt), endedAt: null}, 'outage',
    {firstAt: Date.parse(f.notice.evidence.confirmationStartedAt), lastAt: Date.parse(f.notice.evidence.confirmedAt)});
  await assert.rejects(f.store.stage(f.lease, {...emptyNoticeState(), conflicted: true}, [notice]), /capacity/);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM notice_delivery').get().n, 2000);
  assert.equal(record(f).state, 'uncertain');
  assert.equal(f.db.raw.prepare('SELECT state_json FROM notice_control').get().state_json, before);
});

test('bounded public payload rejects raw fields and substituted links before SQL writes', async t => {
  const f = await staged(t);
  for (const notice of [{...f.notice, rawProbe: 'private'}, {...f.notice, statusUrl: 'https://private.invalid'}])
    await assert.rejects(f.store.stage(f.lease, emptyNoticeState(), [notice]), /projection/);
  await assert.rejects(f.store.stage(f.lease, {...emptyNoticeState(), extra: 'private'}, []), /durable/);
  assert.equal(record(f).payload_json, JSON.stringify(f.notice));
});

test('clock rollback and exhausted generations fail closed', async t => {
  const f = persistentFixture(t); await f.store.setEnabled(true); f.now--;
  assert.equal(await f.store.acquire(token), null);
  await assert.rejects(f.store.setEnabled(false), /clock/);
  f.now++; f.db.raw.exec('UPDATE notice_control SET generation=9007199254740991');
  assert.equal(await f.store.acquire(token), null);
});

test('SQL storage bounds and attempt ceiling do not erase retained identities', async t => {
  const f = await staged(t);
  assert.throws(() => f.db.raw.prepare('UPDATE notice_control SET state_json=?').run('x'.repeat(1_048_577)), /CHECK/);
  assert.throws(() => f.db.raw.prepare('UPDATE notice_delivery SET payload_json=?').run('x'.repeat(4097)), /CHECK/);
  f.db.raw.exec('UPDATE notice_delivery SET attempts=1000');
  assert.equal(await f.store.start(f.lease, f.notice.key), null);
  assert.equal(record(f).state, 'ready'); assert.equal(record(f).attempts, 1000);
});

test('noncanonical fingerprints and corrupt loaded state fail closed before delivery', async t => {
  const f = await staged(t);
  await assert.rejects(f.store.stage(f.lease, {...emptyNoticeState(), samples: 1}, []), /durable/);
  f.db.raw.prepare('UPDATE notice_control SET state_json=?').run(JSON.stringify({...emptyNoticeState(), extra: 'private'}));
  await assert.rejects(f.store.load(f.lease), /durable/);
  const state = {...emptyNoticeState(), observedAt: f.now,
    fingerprint: JSON.stringify({checkedAt: f.now, components: [], incidents: [], secret: 'private'})};
  await assert.rejects(f.store.stage(f.lease, state, []), /notice evidence/);
  assert.equal(record(f).state, 'ready');
});
