// Dependency-free, offline regression suite: node --test <this file>.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

const maximumBytes = 32 * 1024 * 1024;
let moduleId = 0;

async function loadProxy(t, origin = 'http://127.0.0.1:3104') {
	const previous = { ...process.env };
	process.env.FRONTEND_V4_ORIGIN = origin;
	delete process.env.ENABLE_FRONTEND_V4_PREVIEW;
	delete process.env.DISABLE_FRONTEND_V4_PREVIEW;
	t.after(() => {
		for (const name of ['FRONTEND_V4_ORIGIN', 'ENABLE_FRONTEND_V4_PREVIEW',
			'DISABLE_FRONTEND_V4_PREVIEW']) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
	});
	return (await import(`../FrontendV4Proxy.ts?test=${++moduleId}`))
		.frontendV4ProxyMiddleware;
}

function invoke(proxy, originalUrl, method = 'GET', headers = {}) {
	const res = new EventEmitter();
	res.statusCode = 200;
	res.headers = {};
	res.headersSent = false;
	res.status = (status) => { res.statusCode = status; return res; };
	res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
	let complete;
	const done = new Promise((resolve) => { complete = resolve; });
	res.end = () => { res.headersSent = true; complete(res); };
	res.send = (body) => { res.body = body; res.end(); };
	res.destroy = () => { res.destroyed = true; complete(res); };
	proxy({ method, originalUrl, get: (name) => headers[name] }, res, () => {
		res.skipped = true;
		complete(res);
	});
	return { res, done };
}

test('GET preserves the trusted origin, pathname, query, status and safe headers', async (t) => {
	const proxy = await loadProxy(t);
	const calls = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		calls.push({ url, options });
		return new Response('preview', { status: 200, headers: {
			'content-type': 'text/html', 'cache-control': 'no-cache', etag: '"v1"',
			'set-cookie': 'must-not-forward=yes'
		} });
	});
	const result = await invoke(proxy, '/new-ui/docs/a%20b?target=https%3A%2F%2Fother.invalid&x=1',
		'GET', { accept: 'text/html', 'user-agent': 'test-agent', authorization: 'secret' }).done;
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url.href,
		'http://127.0.0.1:3104/docs/a%20b?target=https%3A%2F%2Fother.invalid&x=1');
	assert.equal(calls[0].options.redirect, 'manual');
	assert.deepEqual(calls[0].options.headers, { accept: 'text/html', 'user-agent': 'test-agent' });
	assert.equal(calls[0].options.signal.aborted, true);
	assert.equal(result.statusCode, 200);
	assert.equal(result.body.toString(), 'preview');
	assert.equal(result.headers.etag, '"v1"');
	assert.equal(result.headers['set-cookie'], undefined);
});

test('root query and Next asset paths remain ordinary fixed-origin paths', async (t) => {
	const proxy = await loadProxy(t);
	const urls = [];
	t.mock.method(globalThis, 'fetch', async (url) => {
		urls.push(url.href);
		return new Response('asset');
	});
	await invoke(proxy, '/new-ui?x=1').done;
	await invoke(proxy, '/_next/static/chunk.js?v=1').done;
	assert.deepEqual(urls, ['http://127.0.0.1:3104/?x=1',
		'http://127.0.0.1:3104/_next/static/chunk.js?v=1']);
});

test('ambiguous paths are rejected before any outbound transport', async (t) => {
	const proxy = await loadProxy(t);
	const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
	for (const path of ['/new-ui//other.invalid/x', '/new-ui/\\other.invalid/x',
		'/new-ui\\other.invalid/x', '/new-ui/%2f%2fother.invalid/x', '/new-ui/%5cother.invalid',
		'/new-ui/%252f%252fother.invalid', '/new-ui/../admin', '/new-ui/%2e%2e/admin',
		'/new-ui/x/./y', '/new-ui/x//y', '/new-ui/x#fragment', '/new-ui/\t/x',
		'/new-ui/x?q=%0d%0aheader', '/new-ui/x?q=bad\\value', '/new-ui/%zz',
		'/new-ui/%ff', '/_next//other.invalid/x']) {
		const result = await invoke(proxy, path).done;
		assert.equal(result.statusCode, 400, path);
	}
	assert.equal(fetch.mock.callCount(), 0);
});

test('invalid origin configuration fails closed without outbound transport', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
	for (const origin of ['file:///tmp/', 'http://user:password@127.0.0.1:3104',
		'http://127.0.0.1:3104/path', 'http://127.0.0.1:3104/?x=1',
		'http://127.0.0.1:3104/#fragment', 'http:\\other.invalid', ' http://other.invalid']) {
		const proxy = await loadProxy(t, origin);
		const result = await invoke(proxy, '/new-ui/').done;
		assert.equal(result.statusCode, 502, origin);
		assert.equal(result.body, 'Frontend v4 preview unavailable');
	}
	assert.equal(fetch.mock.callCount(), 0);
});

test('manual redirects never fetch a second hop and reject other origins', async (t) => {
	const proxy = await loadProxy(t);
	let location = 'http://other.invalid/internal';
	const fetch = t.mock.method(globalThis, 'fetch', async () =>
		new Response(null, { status: 302, headers: { location } }));
	for (location of ['http://other.invalid/internal', '//other.invalid/x',
		'http://127.0.0.1:3105/x', 'http://name:secret@127.0.0.1:3104/x', '/\\other.invalid/x']) {
		assert.equal((await invoke(proxy, '/new-ui/docs/').done).statusCode, 502);
	}
	assert.equal(fetch.mock.callCount(), 5);
	location = '../login?next=%2Fdocs#sign-in';
	const result = await invoke(proxy, '/new-ui/docs/').done;
	assert.equal(result.statusCode, 302);
	assert.equal(result.headers.location, '/new-ui/login?next=%2Fdocs#sign-in');
	assert.equal(fetch.mock.callCount(), 6);
});

test('HEAD never buffers the upstream body', async (t) => {
	const proxy = await loadProxy(t);
	let read = false;
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		assert.equal(options.method, 'HEAD');
		return { status: 200, headers: new Headers({ 'content-type': 'text/html' }),
			body: { getReader() { read = true; throw new Error('must not read'); } } };
	});
	const result = await invoke(proxy, '/new-ui/', 'HEAD').done;
	assert.equal(result.statusCode, 200);
	assert.equal(result.body, undefined);
	assert.equal(read, false);
});

test('ordinary HTTP errors and bodyless statuses retain their semantics', async (t) => {
	const proxy = await loadProxy(t);
	let status = 404;
	t.mock.method(globalThis, 'fetch', async () => new Response(
		status === 404 ? 'not found' : null, { status }
	));
	const missing = await invoke(proxy, '/new-ui/missing').done;
	assert.equal(missing.statusCode, 404);
	assert.equal(missing.body.toString(), 'not found');
	for (status of [204, 205, 304]) {
		const result = await invoke(proxy, '/new-ui/').done;
		assert.equal(result.statusCode, status);
		assert.equal(result.body, undefined);
	}
});

test('unsupported methods, disabled preview and unrelated routes never fetch', async (t) => {
	const proxy = await loadProxy(t);
	const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
	const post = await invoke(proxy, '/new-ui/', 'POST').done;
	assert.equal(post.statusCode, 405);
	assert.equal(post.headers.allow, 'GET, HEAD');
	assert.equal((await invoke(proxy, '/new-ui-other').done).skipped, true);
	process.env.DISABLE_FRONTEND_V4_PREVIEW = '1';
	assert.equal((await invoke(proxy, '/new-ui/').done).skipped, true);
	assert.equal(fetch.mock.callCount(), 0);
});

test('declared oversize and actual chunked oversize bodies fail closed', async (t) => {
	const proxy = await loadProxy(t);
	let canceled = false;
	let signal;
	let declared = true;
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		signal = options.signal;
		if (declared) return new Response('too large', {
			headers: { 'content-length': String(maximumBytes + 1) }
		});
		return new Response(new ReadableStream({
			pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
			cancel() { canceled = true; }
		}), { headers: { 'content-length': '1' } });
	});
	assert.equal((await invoke(proxy, '/new-ui/').done).statusCode, 502);
	assert.equal(signal.aborted, true);
	declared = false;
	assert.equal((await invoke(proxy, '/new-ui/').done).statusCode, 502);
	assert.equal(signal.aborted, true);
	assert.equal(canceled, true);
});

test('the total deadline aborts both stalled headers and stalled body reads', async (t) => {
	const proxy = await loadProxy(t);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let signal;
	let bodyStarted;
	let bodyMode = false;
	t.mock.method(globalThis, 'fetch', (_url, options) => {
		signal = options.signal;
		if (!bodyMode) return new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
		});
		return Promise.resolve(new Response(new ReadableStream({ start(controller) {
			bodyStarted();
			signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
		} })));
	});
	const headersRequest = invoke(proxy, '/new-ui/');
	t.mock.timers.tick(30_000);
	assert.equal((await headersRequest.done).statusCode, 502);
	assert.equal(signal.aborted, true);
	bodyMode = true;
	const started = new Promise((resolve) => { bodyStarted = resolve; });
	const bodyRequest = invoke(proxy, '/new-ui/');
	await started;
	await Promise.resolve();
	t.mock.timers.tick(30_000);
	assert.equal((await bodyRequest.done).statusCode, 502);
	assert.equal(signal.aborted, true);
});

test('client disconnect aborts the in-flight upstream request', async (t) => {
	const proxy = await loadProxy(t);
	let signal;
	t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
		signal = options.signal;
		signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	}));
	const request = invoke(proxy, '/new-ui/');
	request.res.emit('close');
	await request.done;
	assert.equal(signal.aborted, true);
	assert.equal(request.res.listenerCount('close'), 0);
});
