import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataReadiness } from '../lib/monitor.mjs';
const now = Date.parse('2026-11-01T04:06:00.000Z');
const ready = () => ({ status: 'ready', generatedAt: new Date(now).toISOString(), checks: {
  clickhouse: { status: 'ready' }, publication: { status: 'ready' }, archive: { status: 'ready' }
} });
test('archive-summary age alone does not report a data-server interruption', () => {
  const body = ready(); body.status = 'not_ready';
  body.checks.archive = { status: 'stale', observedAt: new Date(now - 97_000).toISOString() };
  assert.equal(dataReadiness(body, now).ok, true);
});
test('an actual unavailable data check retains its specific reported reason', () => {
  const body = ready(); body.checks.clickhouse = { status: 'unavailable' };
  assert.deepEqual(dataReadiness(body, now), { ok: false, reasonCode: 'data_unavailable',
    probeDetail: { kind: 'readiness', check: 'clickhouse', status: 'unavailable' } });
});
test('stale publication is available and retains whole-second lag detail', () => {
  const body = ready(); body.checks.publication = { status: 'stale', observedAt: new Date(now - 97_750).toISOString() };
  body.status = 'not_ready';
  assert.equal(dataReadiness(body, now).ok, true);
  assert.equal(dataReadiness(body, now).reasonCode, 'ok');
  assert.deepEqual(dataReadiness(body, now).probeDetail, { kind: 'readiness', check: 'publication', status: 'stale', ageSeconds: 97 });
});
test('publication lag uses the actual completed-publication time', () => {
  const body = ready(); body.checks.publication = { status: 'stale', observedAt: new Date(now).toISOString(),
    latestCompletedAt: new Date(now - 90_000_000).toISOString() };
  assert.deepEqual(dataReadiness(body, now), { ok: true, reasonCode: 'ok',
    probeDetail: { kind: 'readiness', check: 'publication', status: 'stale', ageSeconds: 90000 } });
});
test('a failed publication dependency is not hidden by live ClickHouse', () => {
  const body = ready(); body.checks.publication = { status: 'unavailable' };
  assert.deepEqual(dataReadiness(body, now), { ok: false, reasonCode: 'data_unavailable',
    probeDetail: { kind: 'readiness', check: 'publication', status: 'unavailable' } });
});
test('missing, old and future health observations fail closed', () => {
  assert.equal(dataReadiness({}, now).ok, false);
  assert.equal(dataReadiness({ ...ready(), generatedAt: new Date(now - 300_000).toISOString() }, now).ok, false);
  assert.equal(dataReadiness({ ...ready(), generatedAt: new Date(now + 6_000).toISOString() }, now).ok, false);
  assert.equal(dataReadiness({ generatedAt: new Date(now).toISOString(), status: 'ready' }, now).ok, false);
});
