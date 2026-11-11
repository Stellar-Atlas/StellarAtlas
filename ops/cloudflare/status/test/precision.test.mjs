import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { duration, segmentsFor } from '../public/history.mjs';

test('durations retain whole-second precision across minute, hour and day boundaries', () => {
  for (const [ms, expected] of [
    [0, '0s'], [999, '0s'], [1000, '1s'], [59999, '59s'],
    [60000, '1m 0s'], [61000, '1m 1s'], [3599000, '59m 59s'],
    [3601000, '1h 0m 1s'], [86401000, '1d 0h 0m 1s']
  ]) assert.equal(duration(ms), expected);
});

test('ongoing incidents retain observation milliseconds until display formatting', () => {
  const data = { monitoringSince: 1000, lastCheckedAt: 1000, historyComplete: true,
    recentIncidents: [{ component: 'data', startedAt: 1234, endedAt: null }] };
  const segments = segmentsFor(data, 'data', 1000, 100000, 62235);
  const interrupted = segments.filter(item => item.state === 'degraded');
  assert.equal(interrupted.reduce((sum, item) => sum + item.end - item.start, 0), 61001);
  assert.equal(duration(interrupted[0].end - interrupted[0].start), '1m 1s');
});

test('UTC labels include seconds and polling remains once per visible minute', async () => {
  const status = await readFile(new URL('../public/status.js', import.meta.url), 'utf8');
  const stampSource = status.match(/^const stamp = (.*);$/m)?.[1];
  const labelSource = status.match(/^const timeLabel = (.*);$/m)?.[1];
  assert.ok(stampSource && labelSource);
  const stamp = Function('return (' + stampSource + ')')();
  const label = Function('return (' + labelSource + ')')();
  const value = Date.parse('2026-11-01T04:05:06.789Z');
  assert.match(stamp(value), /04:05:06.*UTC/);
  assert.match(label(value), /04:05:06/);
  assert.match(status, /setInterval\(.*60000\)/);
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('Checks every minute. Incident times are observations.'));
});

test('the page publishes check purposes, freshness rules and the limits of history', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const method = html.match(/<section[^>]+aria-labelledby="check-method">([\s\S]+?)<\/section>/)?.[1];
  assert.ok(method);
  assert.match(method, /one-minute schedule/);
  assert.match(method, /more than 3 minutes old.*shows the current status as unknown/);
  assert.match(method, /Primary server.*reported availability/);
  assert.match(method, /Data server.*query returns the expected result.*less than 5 minutes old.*at least one completed batch and at least one published row.*75 seconds old.*24 hours old/);
  assert.match(method, /Failover service.*both saved snapshots have capture timestamps.*Snapshot age is shown for reference/);
  assert.match(method, /A valid health response can report stale data/);
  assert.match(method, /Last checked.*result.*when the saved snapshots were captured/);
  assert.match(html, /Grey marks periods treated as unmonitored.*Green means no outage was recorded.*can miss individual gaps/);
});
