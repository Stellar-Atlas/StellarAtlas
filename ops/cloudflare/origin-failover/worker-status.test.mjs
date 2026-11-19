import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { test } from 'node:test';

const source = await readFile(new URL('./worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { createGateway } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const statusUrl = 'https://api.stellaratlas.io/v1/status/workers';

function fixture(fetchOrigin = async () => new Response('origin')) {
  const calls = [];
  const handle = createGateway((...args) => { calls.push(args); return fetchOrigin(...args); });
  const env = { MIRROR: { fetch: () => assert.fail('worker status must not use snapshots') } };
  return { calls, run: request => handle(request, env) };
}

test('exact public worker GET uses the existing apex proxy and preserves query/headers/response', async () => {
  for (const search of ['', '?limit=32&cursor=%2F%2B&__origin=down']) {
    const response = new Response('{"workers":[{"id":"fixture-worker"}]}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-upstream': 'fixture' }
    });
    const f = fixture(async () => response);
    const request = new Request(statusUrl + search, { headers: {
      host: 'api.stellaratlas.io', accept: 'application/json',
      cookie: 'atlas_snapshot=1; session=test-only', 'x-request-id': 'fixture'
    } });
    assert.equal(await f.run(request), response);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].length, 1, 'preserve raw origin fetch without extra deadline options');
    const upstream = f.calls[0][0];
    assert.equal(upstream.url, 'https://stellaratlas.io/v1/status/workers' + search);
    assert.equal(upstream.method, 'GET');
    assert.equal(upstream.headers.get('host'), 'stellaratlas.io');
    assert.equal(request.headers.get('host'), 'api.stellaratlas.io', 'do not mutate caller headers');
    for (const name of ['accept', 'cookie', 'x-request-id']) {
      assert.equal(upstream.headers.get(name), request.headers.get(name));
    }
    assert.equal(upstream.redirect, request.redirect);
    assert.equal(upstream.cache, request.cache);
    assert.equal(response.headers.get('x-stellaratlas-fallback'), null);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('worker routing leaves other methods, paths, origins, auth and WebSocket selection unchanged', async () => {
  const cases = [
    ...['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(method => ({ url: statusUrl, method })),
    ...[
      statusUrl + '/', statusUrl + '/heartbeat', statusUrl.replace('/workers', '/workers-extra'),
      statusUrl.replace('/workers', '/health'), statusUrl.replace('api.', ''),
      statusUrl.replace('api.', 'www.'), statusUrl.replace('https:', 'http:'),
      statusUrl.replace('.io/', '.io:8443/'), statusUrl.replace('api.stellaratlas.io', 'unrelated.example')
    ].map(url => ({ url })),
    { url: statusUrl, headers: { authorization: 'Bearer test-only', cookie: 'atlas_snapshot=1' } },
    { url: statusUrl, headers: { upgrade: 'websocket', cookie: 'atlas_snapshot=1' } }
  ];
  for (const { url, method = 'GET', headers } of cases) {
    const response = new Response('unchanged', { status: 503 });
    const f = fixture(async () => response);
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 'unchanged-body' : undefined;
    const request = new Request(url, { method, headers, body });
    assert.equal(await f.run(request), response, method + ' ' + url);
    assert.deepEqual(f.calls, [[request]], method + ' ' + url);
    if (body) assert.equal(await f.calls[0][0].text(), body);
  }
});

test('worker upstream errors keep origin-only status handling with no retry or mirror', async () => {
  for (const status of [404, 429, 500, 503]) {
    const response = new Response('original upstream error', { status });
    const f = fixture(async () => response);
    assert.equal(await f.run(new Request(statusUrl)), response);
    assert.equal(f.calls.length, 1);
  }
  const failed = fixture(async () => { throw new TypeError('fixture connection failed'); });
  const result = await failed.run(new Request(statusUrl));
  assert.equal(result.status, 502);
  assert.equal(await result.text(), 'Origin unavailable');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-stellaratlas-fallback'), null);
  assert.equal(failed.calls.length, 1);
});

test('worker proxy adds no deadline and preserves caller cancellation after accepted headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = t.mock.method(globalThis, 'setTimeout');
  const controller = new AbortController();
  const response = new Response('stream remains origin-owned');
  const f = fixture(async () => response);
  assert.equal(await f.run(new Request(statusUrl, { signal: controller.signal })), response);
  assert.equal(timer.mock.callCount(), 0);
  t.mock.timers.tick(100_000);
  const signal = f.calls[0][0].signal;
  assert.equal(signal.aborted, false);
  const reason = new Error('fixture caller disconnected');
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
  assert.equal(f.calls.length, 1);
});
