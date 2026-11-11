import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {runScheduledCheck} from '../trigger/worker.mjs';

test('scheduler only invokes the fixed authenticated Pages endpoint', async () => {
  const token = 'a'.repeat(64); let calls = 0;
  await runScheduledCheck({STATUS_MONITOR_TOKEN: token}, async (url, init) => {
    calls++; assert.equal(url, 'https://stellaratlas-status.pages.dev/api/internal/check');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.authorization, 'Bearer ' + token);
    return new Response(null, {status: 200});
  });
  assert.equal(calls, 1); assert.equal(worker.fetch().status, 404);
});

test('missing authorization or failed checks never appear successful', async () => {
  await assert.rejects(runScheduledCheck({}, () => { throw Error('Must not run'); }), /not configured/);
  await assert.rejects(runScheduledCheck({STATUS_MONITOR_TOKEN: 'a'.repeat(64)}, async () =>
    new Response(null, {status: 503})), /unsuccessful/);
});
