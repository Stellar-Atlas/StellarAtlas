import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { test } from 'node:test';

const source = await readFile(new URL('./worker.ts', import.meta.url), 'utf8');
const compiled = process.env.ATLAS_GATEWAY_FROZEN === '1'
  ? await readFile(new URL('./worker.js', import.meta.url), 'utf8')
  : ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { createGateway } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const publicUrl = 'https://stellaratlas.io/nodes';
const html = { accept: 'text/html' };
const pinned = { ...html, cookie: 'atlas_snapshot=1' };

function fixture(origin = async () => new Response('origin')) {
  const calls = { origin: [], mirror: [] };
  const handle = createGateway(async (...args) => {
    calls.origin.push(args);
    return origin(...args);
  });
  const env = {
    ORIGIN_HEADER_TIMEOUT_MS: '100', STATUS_HEADER_TIMEOUT_MS: '100',
    MIRROR: { fetch: async (request) => {
      calls.mirror.push(request);
      return new Response('mirror', { headers: { 'Content-Type': 'text/html' } });
    } }
  };
  return { calls, env, run: (request) => handle(request, env) };
}

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const walletPath = '/v1/analytics/accounts/' + account + '/balances';
const liveCursor = Buffer.from(JSON.stringify([1, account, 0, '', ''])).toString('base64url');
const savedCursor = Buffer.from(JSON.stringify(['fixture-generation', 'wallet', account, 'asset', 'asc', false, 'native'])).toString('base64url');
const walletUrls = ['stellaratlas.io', 'api.stellaratlas.io'].flatMap(host => [
  'https://' + host + walletPath + '?limit=25',
  'https://' + host + walletPath + '?limit=25&after=' + liveCursor
]);

test('wallet live response, error fallback, affinity and cancellation forward exactly once', async () => {
  for (const url of walletUrls) {
    const missing = new Response(null, { status: 404 });
    const f = fixture(async () => missing);
    assert.equal(await f.run(new Request(url)), missing);
    assert.equal(f.calls.origin[0][0].url, url);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 0);

    for (const failure of ['503', 'fetch']) {
      let bodyCanceled = false;
      const failed = fixture(async () => {
        if (failure === 'fetch') throw new TypeError('fixture connection failed');
        return new Response(new ReadableStream({ cancel() { bodyCanceled = true; } }), { status: 503 });
      });
      failed.env.MIRROR.fetch = async (request) => {
        failed.calls.mirror.push(request);
        return Response.json({ generation: 'fixture-generation' }, {
          status: url.includes('&after=') ? 400 : 200,
          headers: { 'X-StellarAtlas-Snapshot': '2026-11-03T00:00:00Z' }
        });
      };
      const result = await failed.run(new Request(url));
      assert.equal(result.status, url.includes('&after=') ? 400 : 200);
      assert.equal(result.headers.get('x-stellaratlas-fallback'), 'snapshot');
      assert.equal(result.headers.get('x-stellaratlas-snapshot'), '2026-11-03T00:00:00Z');
      assert.deepEqual(failed.calls.origin.map(([request]) => request.url), [url]);
      assert.deepEqual(failed.calls.mirror.map(request => request.url), [url]);
      if (failure === '503') assert.equal(bodyCanceled, true);
    }

    const pinned = fixture(() => assert.fail('pinned wallet contacted origin'));
    const savedUrl = new URL(url);
    if (savedUrl.searchParams.has('after')) savedUrl.searchParams.set('after', savedCursor);
    assert.equal((await pinned.run(new Request(savedUrl, { headers: { cookie: 'atlas_snapshot=1' } })))
      .headers.get('x-stellaratlas-fallback'), 'snapshot');
    assert.equal(pinned.calls.origin.length, 0);
    assert.deepEqual(pinned.calls.mirror.map(request => request.url), [savedUrl.href]);

    const controller = new AbortController(), reason = new Error('client disconnected');
    const abort = fixture(async (_request, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const pending = abort.run(new Request(url, { signal: controller.signal }));
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(abort.calls.origin[0][1].signal.reason, reason);
    assert.equal(abort.calls.origin.length, 1);
    assert.equal(abort.calls.mirror.length, 0);
  }
});

test('saved archive inventory respects affinity, outage fallback, and origin-only exclusions', async () => {
  const url = 'https://stellaratlas.io/api/archive-inventory';
  for (const affinity of [false, true]) {
    const live = new Response('{"live":true}', { headers: { 'content-type': 'application/json' } });
    const f = fixture(async () => live);
    const response = await f.run(new Request(url, { headers: {
      accept: 'application/json', ...(affinity ? { cookie: 'atlas_snapshot=1' } : {})
    } }));
    assert.equal(f.calls.origin.length, affinity ? 0 : 1);
    assert.equal(f.calls.mirror.length, affinity ? 1 : 0);
    if (!affinity) { assert.equal(response, live); assert.equal(response.headers.get('x-stellaratlas-fallback'), null); }
    else assert.equal(response.headers.get('x-stellaratlas-fallback'), 'snapshot');
  }
  const down = fixture(async () => new Response(null, { status: 503 }));
  const saved = await down.run(new Request(url, { headers: { accept: 'application/json' } }));
  assert.equal(saved.headers.get('x-stellaratlas-fallback'), 'snapshot');
  assert.equal(down.calls.origin.length, 1); assert.equal(down.calls.mirror.length, 1);
  for (const options of [
    { method: 'POST', body: '{}', headers: pinned },
    { method: 'PUT', body: '{}', headers: pinned },
    { headers: { ...pinned, authorization: 'Bearer test-only' } },
    { headers: { ...pinned, upgrade: 'websocket' } }
  ]) {
    const live = new Response(null, { status: 503 }), f = fixture(async () => live);
    assert.equal(await f.run(new Request(url, options)), live);
    assert.equal(f.calls.origin.length, 1); assert.equal(f.calls.mirror.length, 0);
  }
  const excluded = fixture(async () => new Response(null, { status: 503 }));
  await excluded.run(new Request(url + '/private', { headers: pinned }));
  assert.equal(excluded.calls.mirror.length, 0, 'allowlist is exact');
});

test('saved Explorer reads use origin first unless pinned, with an explicit public path', async () => {
  const paths = ['/v1/assets', '/v1/assets/native', '/v1/assets/native/holders',
    '/v1/assets/native/balances', '/v1/analytics/assets/native/holders',
    '/v1/analytics/accounts/GACCOUNT/balances', '/v1/issuers/GISSUER',
    '/v1/liquidity-pools', '/v1/liquidity-pools/pool', '/v1/asset-metadata'];
  for (const path of paths) {
    for (const affinity of [false, true]) {
      const f = fixture();
      await f.run(new Request('https://stellaratlas.io' + path, {
        headers: { accept: 'application/json', ...(affinity ? { cookie: 'atlas_snapshot=1' } : {}) }
      }));
      assert.equal(f.calls.mirror.length, affinity ? 1 : 0, path);
      assert.equal(f.calls.origin.length, affinity ? 0 : 1, path);
    }
  }
  for (const path of ['/v1/accounts/GACCOUNT', '/v1/assets/native/private/secret',
    '/v1/assets/native/rankings', '/v1/stream/data', '/v1/private', '/v1/trades']) {
    const f = fixture();
    await f.run(new Request('https://stellaratlas.io' + path, { headers: pinned }));
    assert.equal(f.calls.mirror.length, 0, path);
  }
  for (const options of [
    { method: 'POST', headers: pinned, body: '{}' },
    { headers: { ...pinned, authorization: 'Bearer test-only' } },
    { headers: { ...pinned, upgrade: 'websocket' } }
  ]) {
    const f = fixture();
    await f.run(new Request('https://stellaratlas.io/v1/assets/native', options));
    assert.equal(f.calls.mirror.length, 0);
  }
});

test('healthy unpinned saved API keeps the exact origin response without fallback headers', async () => {
  const response = new Response('{"live":true}', {
    headers: { 'content-type': 'application/json', 'x-origin': 'unchanged' }
  });
  const f = fixture(async () => response);
  const request = new Request('https://stellaratlas.io/v1/assets/native', {
    headers: { accept: 'application/json' }
  });
  assert.equal(await f.run(request), response);
  assert.equal(response.headers.get('x-stellaratlas-fallback'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.calls.origin[0][0], request);
  assert.equal(f.calls.origin[0].length, 2);
  assert.equal(f.calls.origin[0][1].signal.aborted, false);
  assert.equal(f.calls.mirror.length, 0);
});

test('unpinned saved API falls back on origin 500 or network error and cancels failed body', async () => {
  let cancelled = false;
  for (const origin of [
    async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 500 }),
    async () => { throw new Error('offline'); }
  ]) {
    const f = fixture(origin);
    f.env.MIRROR.fetch = async request => {
      f.calls.mirror.push(request);
      return new Response('{"saved":true}', { headers: { 'content-type': 'application/json' } });
    };
    const request = new Request('https://stellaratlas.io/v1/assets/native', {
      headers: { accept: 'application/json' }
    });
    const response = await f.run(request);
    assert.deepEqual(await response.json(), { saved: true });
    assert.equal(response.headers.get('x-stellaratlas-fallback'), 'snapshot');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 1);
    assert.equal(f.calls.mirror[0], request);
  }
  assert.equal(cancelled, true);
});

test('unpinned saved API preserves origin 404 unchanged', async () => {
  const response = new Response('{"notFound":true}', {
    status: 404, headers: { 'content-type': 'application/json' }
  });
  const f = fixture(async () => response);
  assert.equal(await f.run(new Request('https://stellaratlas.io/v1/assets/missing')), response);
  assert.equal(f.calls.mirror.length, 0);
  assert.equal(response.headers.get('x-stellaratlas-fallback'), null);
});

test('captured core data fails over explicitly without replacing health, metrics or live streams', async () => {
  const paths = ['/v1', '/v1/nodes', '/v1/nodes/GNODE', '/v1/organizations', '/v1/organizations/org',
    '/v1/known/nodes', '/v1/known/organizations', '/v1/known/nodes/GNODE',
    '/v1/known/organizations/example.com', '/v1/search?q=node',
    '/v1/known/nodes/GNODE/archive-evidence?eventLimit=0',
    '/v1/archive-scans/objects/status-summary',
    '/v1/scp/evidence/animation-backlog?limit=4', '/v2/archive-scans/encoded/object-evidence'];
  for (const path of paths) {
    const f = fixture(async () => new Response(null, { status: 503 }));
    const r = await f.run(new Request('https://api.stellaratlas.io' + path));
    assert.equal(r.headers.get('x-stellaratlas-fallback'), 'snapshot', path);
    assert.equal(f.calls.mirror.length, 1, path);
  }
  for (const path of ['/v1/status/api', '/v1/status/full-history', '/v1/public-goods/health',
    '/v1/public-goods/metrics', '/v1/scp/stream', '/v1/scp/evidence/live',
    '/v1/archive-scans/repair', '/v2/archive-scans/encoded/repair']) {
    const f = fixture(async () => new Response(null, { status: 503 }));
    const r = await f.run(new Request('https://api.stellaratlas.io' + path, { headers: pinned }));
    assert.equal(r.status, 503, path);
    assert.equal(f.calls.mirror.length, 0, path);
  }
});

test('public saved API keeps public CORS on outage without enabling authenticated preflights', async () => {
  const f = fixture(async () => new Response(null, { status: 503 }));
  const url = 'https://api.stellaratlas.io/v1/assets/native';
  const saved = await f.run(new Request(url, { headers: { origin: 'https://example.com' } }));
  assert.equal(saved.headers.get('access-control-allow-origin'), '*');
  assert.equal(saved.headers.get('access-control-allow-credentials'), null);
  const preflight = await f.run(new Request(url, { method: 'OPTIONS', headers: {
    origin: 'https://example.com', 'access-control-request-method': 'GET',
    'access-control-request-headers': 'content-type'
  } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.equal(preflight.headers.get('x-stellaratlas-fallback'), 'snapshot');
  const denied = await f.run(new Request(url, { method: 'OPTIONS', headers: {
    'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization'
  } }));
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(f.calls.mirror.length, 1);
});

test('saved API auth, writes and WebSockets remain origin-only when origin fails', async () => {
  for (const options of [
    { headers: { authorization: 'Bearer test-only', cookie: 'atlas_snapshot=1' } },
    { method: 'POST', body: '{}', headers: { cookie: 'atlas_snapshot=1' } },
    { headers: { upgrade: 'websocket', cookie: 'atlas_snapshot=1' } }
  ]) {
    const response = new Response(null, { status: 503 });
    const f = fixture(async () => response);
    assert.equal(await f.run(new Request('https://stellaratlas.io/v1/assets/native', options)), response);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 0);
  }
});

test('saved API HEAD forwards the method and returns mirror HEAD semantics', async () => {
  for (const affinity of [false, true]) {
    const f = fixture(async () => new Response(null, { status: 503 }));
    f.env.MIRROR.fetch = async request => {
      f.calls.mirror.push(request);
      assert.equal(request.method, 'HEAD');
      return new Response(null, { headers: { 'content-type': 'application/json' } });
    };
    const response = await f.run(new Request('https://stellaratlas.io/v1/assets/native', {
      method: 'HEAD', headers: affinity ? { cookie: 'atlas_snapshot=1' } : {}
    }));
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('x-stellaratlas-fallback'), 'snapshot');
    assert.equal(f.calls.origin.length, affinity ? 0 : 1);
    assert.equal(f.calls.mirror.length, 1);
  }
});

test('healthy response and production request forwarded unchanged', async () => {
  const response = new Response('live stream', { headers: { 'x-origin': 'yes' } });
  const f = fixture(async () => response);
  const request = new Request(`${publicUrl}?__origin=down`, { headers: html });
  assert.equal(await f.run(request), response);
  assert.equal(f.calls.origin[0][0], request);
  assert.equal(f.calls.mirror.length, 0);
});

test('direct production APIs, writes, auth and upgrades do not inherit HTML header deadlines', async () => {
  await Promise.all([
    { url: 'https://stellaratlas.io/v1/analytics/transactions', options: {} },
    { url: publicUrl, options: { method: 'POST', body: 'unchanged' } },
    { url: publicUrl, options: { headers: { authorization: 'Bearer test-only' } } },
    { url: publicUrl, options: { headers: { upgrade: 'websocket' } } }
  ].map(async ({ url, options }) => {
    const f = fixture(async () => {
      await new Promise(resolve => setTimeout(resolve, 160));
      return new Response('slow origin');
    });
    const request = new Request(url, options);
    assert.equal(await (await f.run(request)).text(), 'slow origin');
    assert.equal(f.calls.origin[0][0], request);
    assert.equal(f.calls.origin[0].length, 1, 'no extra abort signal');
    assert.equal(f.calls.mirror.length, 0);
  }));
  const failure = fixture(async () => { throw new Error('offline'); });
  assert.equal((await failure.run(new Request('https://stellaratlas.io/v1/private'))).status, 502);
});

test('healthy streaming body remains un-aborted after header deadline', async () => {
  let signal;
  const f = fixture(async (_request, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('late')); controller.close(); }, 160);
    } }));
  });
  const response = await f.run(new Request(publicUrl, { headers: html }));
  assert.equal(await response.text(), 'late');
  assert.equal(signal.aborted, false);
});

test('5xx and network failure select mirror HTML with cookie and no-store', async () => {
  for (const origin of [async () => new Response('error', { status: 503 }), async () => { throw Error('offline'); }]) {
    const f = fixture(origin);
    const response = await f.run(new Request(publicUrl, { headers: html }));
    assert.equal(await response.text(), 'mirror');
    assert.match(response.headers.get('set-cookie'), /atlas_snapshot=1; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-stellaratlas-fallback'), 'snapshot');
    assert.equal(f.calls.mirror.length, 1);
  }
});

test('origin header timeout falls back within bounded deadline', async () => {
  const f = fixture((_request, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true });
  }));
  const start = performance.now();
  assert.equal(await (await f.run(new Request(publicUrl, { headers: html }))).text(), 'mirror');
  assert.ok(performance.now() - start < 1000);
});

test('ordinary POST, Authorization and WebSocket never reach mirror, even pinned', async () => {
  for (const options of [
    { method: 'POST', headers: pinned, body: 'do not replay' },
    { headers: { ...pinned, authorization: 'Bearer test-not-a-secret' } },
    { headers: { ...pinned, upgrade: 'websocket' } }
  ]) {
    const f = fixture(async () => new Response('down', { status: 503 }));
    const request = new Request(publicUrl, options);
    assert.equal((await f.run(request)).status, 503);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.origin[0][0], request);
    assert.equal(f.calls.mirror.length, 0);
  }
});

test('failed origin RSC becomes empty HTML MPA reload, not mirror RSC', async () => {
  const f = fixture(async () => new Response(null, { status: 502 }));
  const response = await f.run(new Request(`${publicUrl}?_rsc=abc`, { headers: { rsc: '1' } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('set-cookie'), /atlas_snapshot=1/);
  assert.equal(f.calls.mirror.length, 0);
});

test('pinned document, RSC and Next Action go only to read-only mirror', async () => {
  for (const options of [
    { headers: pinned },
    { headers: { ...pinned, rsc: '1' } },
    { method: 'POST', headers: { ...pinned, 'next-action': 'snapshot-action' }, body: 'payload' }
  ]) {
    const f = fixture();
    assert.equal(await (await f.run(new Request(publicUrl, options))).text(), 'mirror');
    assert.equal(f.calls.origin.length, 0);
  }
});

test('private API/arbitrary paths never fail over; snapshot API always mirrors reads', async () => {
  for (const path of ['/api/private', '/internal', '/v1/private', '/nodes-other']) {
    const f = fixture(async () => new Response(null, { status: 503 }));
    assert.equal((await f.run(new Request(`https://stellaratlas.io${path}`, { headers: pinned }))).status, 503);
    assert.equal(f.calls.mirror.length, 0);
  }
  const f = fixture();
  await f.run(new Request('https://stellaratlas.io/api/snapshot/network'));
  assert.equal(f.calls.origin.length, 0);
  assert.equal(f.calls.mirror.length, 1);
});

test('legacy status success cannot establish modern frontend recovery', async () => {
  for (const status of [200, 302, 399, 400, 404, 503]) {
    const f = fixture(async () => new Response(null, { status }));
    const response = await f.run(new Request('https://stellaratlas.io/__failover/status', { headers: pinned }));
    const available = false;
    assert.deepEqual(await response.json(), { available });
    assert.equal(f.calls.origin[0][0].url, 'https://stellaratlas.io/frontend-identity');
    assert.equal(f.calls.origin[0][0].method, 'GET');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (available) assert.match(response.headers.get('set-cookie'), /atlas_snapshot=;.*Max-Age=0/);
    else assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('workers.dev controlled defaults/down/timeout/up; production ignores switch', async () => {
  for (const mode of ['', '?__origin=down', '?__origin=timeout']) {
    const f = fixture();
    const response = await f.run(new Request(`https://gateway.example.workers.dev/nodes${mode}`, { headers: html }));
    assert.equal(await response.text(), 'mirror');
    assert.equal(f.calls.origin.length, 0);
  }
  const f = fixture();
  assert.equal(await (await f.run(new Request('https://gateway.example.workers.dev/nodes?__origin=up&x=1', { headers: html }))).text(), 'origin');
  assert.equal(f.calls.origin[0][0].url, 'https://stellaratlas.io/nodes?x=1');
});

test('healthy 404 is unchanged; HEAD fallback preserves method', async () => {
  const live = new Response(null, { status: 404 });
  const healthy = fixture(async () => live);
  assert.equal(await healthy.run(new Request(publicUrl, { headers: html })), live);
  assert.equal(healthy.calls.mirror.length, 0);
  const down = fixture(async () => new Response(null, { status: 503 }));
  await down.run(new Request(publicUrl, { method: 'HEAD', headers: html }));
  assert.equal(down.calls.mirror[0].method, 'HEAD');
});

test('unpinned or private Next Actions never go to mirror', async () => {
  for (const [url, headers] of [
    [publicUrl, { ...html, 'next-action': 'test' }],
    ['https://stellaratlas.io/api/private', { ...pinned, 'next-action': 'test' }]
  ]) {
    const f = fixture(async () => new Response(null, { status: 503 }));
    const response = await f.run(new Request(url, { method: 'POST', headers, body: 'payload' }));
    assert.equal(response.status, 503);
    assert.equal(f.calls.mirror.length, 0);
  }
});

test('recovery timeout retains affinity, and authorization bypasses recovery handler', async () => {
  const timeout = fixture((_request, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true });
  }));
  const response = await timeout.run(new Request('https://stellaratlas.io/__failover/status', { headers: pinned }));
  assert.deepEqual(await response.json(), { available: false });
  assert.equal(response.headers.get('set-cookie'), null);
  const auth = fixture(async () => new Response('origin-auth'));
  assert.equal(await (await auth.run(new Request('https://stellaratlas.io/__failover/status', {
    headers: { ...pinned, authorization: 'test' }
  }))).text(), 'origin-auth');
  assert.equal(auth.calls.origin[0][0].method, 'GET');
  assert.equal(auth.calls.mirror.length, 0);
});

test('absent/wildcard Accept permits only public core fallback', async () => {
  for (const headers of [{}, { accept: '*/*' }, { accept: '*/*;q=0.8' }]) {
    const core = fixture(async () => new Response(null, { status: 503 }));
    assert.equal(await (await core.run(new Request(publicUrl, { headers }))).text(), 'mirror');
    for (const path of ['/api/private', '/v1/private', '/internal', '/nodes-other']) {
      const excluded = fixture(async () => new Response(null, { status: 503 }));
      assert.equal((await excluded.run(new Request(`https://stellaratlas.io${path}`, { headers }))).status, 503);
      assert.equal(excluded.calls.mirror.length, 0);
    }
  }
  const json = fixture(async () => new Response(null, { status: 503 }));
  assert.equal((await json.run(new Request(publicUrl, { headers: { accept: 'application/json' } }))).status, 503);
  assert.equal(json.calls.mirror.length, 0);
});

test('HEAD recovery has GET availability/cookie semantics without a body', async () => {
  for (const status of [200, 302, 404, 503]) {
    const f = fixture(async () => new Response(null, { status }));
    const response = await f.run(new Request('https://stellaratlas.io/__failover/status', {
      method: 'HEAD', headers: pinned
    }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.equal(f.calls.origin[0][0].url, 'https://stellaratlas.io/frontend-identity');
    assert.equal(f.calls.origin[0][0].method, 'GET');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

const identity = { application: 'stellaratlas-modern-frontend', contractVersion: 1 };
function identityResponse(body = JSON.stringify(identity), headers = {}, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
test('stable identity clears GET/HEAD affinity without a release SHA or cached probe', async () => {
  for (const method of ['GET', 'HEAD']) {
    const f = fixture(async (request, init) => {
      assert.equal(request.url, 'https://stellaratlas.io/frontend-identity');
      assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'manual');
      assert.equal(request.cache, 'no-store'); assert.equal(init.cache, 'no-store');
      assert.equal(request.headers.get('cookie'), null);
      return identityResponse();
    });
    const response = await f.run(new Request('https://stellaratlas.io/__failover/status', {method, headers:pinned}));
    if (method === 'GET') assert.deepEqual(await response.json(), {available:true});
    else assert.equal(await response.text(), '');
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(f.calls.mirror.length, 0);
  }
});
test('wrong identity/media/cache/snapshot/redirect and oversized bodies never clear affinity', async () => {
  const variants = [
    () => identityResponse('<html>legacy</html>', {'content-type':'text/html'}),
    () => identityResponse(JSON.stringify({...identity,application:'legacy'})),
    () => identityResponse(JSON.stringify({...identity,contractVersion:2})),
    () => identityResponse(JSON.stringify({...identity,release:'not part of contract'})),
    () => identityResponse('{'), () => identityResponse(' '.repeat(257)),
    () => identityResponse(undefined, {'x-stellaratlas-fallback':'snapshot'}),
    () => identityResponse(undefined, {'x-stellaratlas-snapshot':'saved'}),
    () => identityResponse(undefined, {'cache-control':'public,max-age=60'}),
    () => identityResponse(undefined, {location:'/frontend-identity'}, 302)
  ];
  for (const variant of variants) {
    const f=fixture(async()=>variant());
    const r=await f.run(new Request('https://stellaratlas.io/__failover/status',{headers:pinned}));
    assert.deepEqual(await r.json(),{available:false}); assert.equal(r.headers.get('set-cookie'),null);
    assert.equal(f.calls.origin.length,1);assert.equal(f.calls.mirror.length,0);
  }
});
test('identity overall deadline bounds ignored header abort and hanging/oversized body, cancelling reads', async () => {
  for (const kind of ['headers','body','oversize']) {
    let cancelled=false;
    const f=fixture(async()=>kind==='headers'?new Promise(()=>{}):identityResponse(new ReadableStream({
      start(c){if(kind==='oversize')c.enqueue(new Uint8Array(257));},cancel(){cancelled=true;}
    })));
    const start=performance.now();const r=await f.run(new Request('https://stellaratlas.io/__failover/status',{headers:pinned}));
    assert.deepEqual(await r.json(),{available:false});assert.equal(r.headers.get('set-cookie'),null);
    assert(performance.now()-start<1000);if(kind!=='headers')assert(cancelled);
  }
});
test('saved-read route matrix preserves no gateway deadline; only page/status retain budgets', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = t.mock.method(globalThis, 'setTimeout');
  const cases = [
    ...walletUrls.map(url => ({ url })),
    ...['GET', 'HEAD'].flatMap(method => [
      walletUrls[0], walletUrls[0].replace('limit=25', 'limit=26'),
      walletUrls[0] + '&extra=1', walletUrls[0].replace('/analytics', ''),
      'https://api.stellaratlas.io/v1/assets/native',
      'https://stellaratlas.io/v1/search?q=known',
      'https://stellaratlas.io/api/archive-inventory',
      'https://api.stellaratlas.io/v2/archive-scans/example/object-evidence'
    ].map(url => ({ url, options: { method } }))),
    { url: 'https://stellaratlas.io/v1/private' },
    { url: walletUrls[0], options: { headers: { authorization: 'Bearer fixture' } } },
    { url: walletUrls[0], options: { headers: { upgrade: 'websocket' } } }
  ];
  for (const { url, options } of cases) {
    timer.mock.resetCalls();
    const f = fixture();
    f.env.ORIGIN_HEADER_TIMEOUT_MS = '8000';
    const response = await f.run(new Request(url, options));
    assert.equal(timer.mock.callCount(), 0, url);
    assert.equal(await response.text(), 'origin');
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 0);
  }
  for (const [url, headers, expected] of [
    [publicUrl, html, 8000],
    ['https://stellaratlas.io/__failover/status', html, 3000],
    ['https://fixture.workers.dev/v1/assets/native?__origin=up', {}, 8000]
  ]) {
    timer.mock.resetCalls();
    const f = fixture(async () => identityResponse());
    f.env.ORIGIN_HEADER_TIMEOUT_MS = '8000'; f.env.STATUS_HEADER_TIMEOUT_MS = '3000';
    await f.run(new Request(url, { headers }));
    assert.deepEqual(timer.mock.calls.map(call => call.arguments[1]), [expected], url);
  }
});

test('saved first/cursor and non-wallet reads succeed at 90 seconds, after former 8s/67s cutoffs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const url of [...walletUrls, 'https://api.stellaratlas.io/v1/assets/native',
    'https://stellaratlas.io/v1/search?q=long']) {
    let complete, rejected = false;
    const live = new Response('late-valid-origin', { headers: { 'content-type': 'application/json' } });
    const f = fixture((_request, init) => new Promise((resolve, reject) => {
      complete = () => resolve(live);
      init.signal.addEventListener('abort', () => { rejected = true; reject(init.signal.reason); }, { once: true });
    }));
    f.env.ORIGIN_HEADER_TIMEOUT_MS = '8000';
    const pending = f.run(new Request(url));
    for (const elapsed of [8000, 59000, 23000]) t.mock.timers.tick(elapsed);
    assert.equal(rejected, false, url);
    assert.equal(f.calls.origin[0][1].signal.aborted, false);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 0);
    complete();
    assert.equal(await pending, live);
    assert.equal(f.calls.origin.length, 1);
    assert.equal(f.calls.mirror.length, 0);
  }
});

test('accepted saved response body has no added deadline and preserves emitted cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, body;
  const incoming = new AbortController();
  const f = fixture(async (_request, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(controller) { body = controller; } }));
  });
  const response = await f.run(new Request(walletUrls[1], { signal: incoming.signal }));
  t.mock.timers.tick(100_000);
  assert.equal(signal.aborted, false);
  body.enqueue(new TextEncoder().encode('late body')); body.close();
  assert.equal(await response.text(), 'late body');
  incoming.abort(new Error('client aborted after headers'));
  assert.equal(signal.aborted, true);
  assert.equal(f.calls.origin.length, 1);
  assert.equal(f.calls.mirror.length, 0);
});

test('incoming cancellation prevents recovery success and saved fallback, including after headers', async () => {
  const controller=new AbortController();const f=fixture((_r,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancel')),{once:true})));
  const pending=f.run(new Request('https://stellaratlas.io/v1/search?q=x',{signal:controller.signal}));controller.abort();
  await assert.rejects(pending);assert.equal(f.calls.mirror.length,0);
  const before=new AbortController();before.abort();const recovery=fixture(async()=>identityResponse());
  const r=await recovery.run(new Request('https://stellaratlas.io/__failover/status',{signal:before.signal,headers:pinned}));
  assert.deepEqual(await r.json(),{available:false});assert.equal(r.headers.get('set-cookie'),null);assert.equal(recovery.calls.origin.length,0);
  const after=new AbortController();let signal;const accepted=fixture(async(_r,init)=>{signal=init.signal;return new Response('ok');});
  await accepted.run(new Request('https://stellaratlas.io/v1/search?q=x',{signal:after.signal}));after.abort();assert.equal(signal.aborted,true);
  const during=new AbortController();let cancelled=false;
  const pendingIdentity=fixture(async()=>identityResponse(new ReadableStream({cancel(){cancelled=true;}})));
  const status=pendingIdentity.run(new Request('https://stellaratlas.io/__failover/status',{signal:during.signal,headers:pinned}));
  setTimeout(()=>during.abort(),10);const statusResponse=await status;
  assert.deepEqual(await statusResponse.json(),{available:false});assert.equal(statusResponse.headers.get('set-cookie'),null);assert(cancelled);
});
