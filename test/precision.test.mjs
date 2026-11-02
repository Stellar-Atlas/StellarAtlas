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
