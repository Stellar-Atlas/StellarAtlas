// Dependency-free; networking below is loopback-only, never public archives.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import test from 'node:test';
import {
	createPublicArchiveLookup,
	isPublicArchiveAddress,
	isPublicArchivePolicyError,
	publicArchiveRequestConfig,
	requirePublicArchiveUrl,
	validatePublicArchiveRedirect
} from '../PublicArchivePolicy.ts';

test('blocks private/special-use literal addresses, mapped IPv6, alternate IPv4 forms and unsafe URLs', () => {
	for (const host of [
		'0.0.0.0',
		'10.1.2.3',
		'100.64.0.1',
		'127.0.0.1',
		'169.254.169.254',
		'172.16.0.1',
		'192.168.1.1',
		'192.0.2.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'[::]',
		'[::1]',
		'[::ffff:127.0.0.1]',
		'[::ffff:8.8.8.8]',
		'[fc00::1]',
		'[fe80::1]',
		'[2001:db8::1]',
		'[2002::1]',
		'[64:ff9b::a00:1]',
		'2130706433',
		'0x7f000001',
		'127.1'
	]) {
		assert.throws(
			() => requirePublicArchiveUrl(`http://${host}/`),
			{ code: 'PUBLIC_ARCHIVE_POLICY' },
			host
		);
	}
	for (const url of [
		'http://localhost/',
		'https://sub.localhost/',
		'http://8.8.8.8:3000/',
		'https://8.8.8.8:80/',
		'http://user:pass@8.8.8.8/',
		'file:///tmp/x',
		'http://8.8.8.8/#fragment',
		'http://8.8.8.8/\\internal',
		'http://8.8.8.8/\n'
	])
		assert.throws(
			() => requirePublicArchiveUrl(url),
			{ code: 'PUBLIC_ARCHIVE_POLICY' },
			url
		);
});

test('preserves public HTTP/HTTPS archive paths and signed queries', () => {
	for (const url of [
		'http://8.8.8.8/path?X-Signature=a%2Fb&Expires=1',
		'https://archive.example/path?token=a%2Bb',
		'https://[2606:4700::1111]/archive'
	])
		assert.equal(requirePublicArchiveUrl(url).href, url);
	assert.equal(isPublicArchiveAddress('8.8.8.8'), true);
	assert.equal(isPublicArchiveAddress('2606:4700::1111'), true);
	assert.equal(isPublicArchiveAddress('invalid'), false);
});

function resolveThrough(lookup, hostname, options = {}) {
	return new Promise((resolve, reject) =>
		lookup(hostname, options, (error, address, family) =>
			error ? reject(error) : resolve({ address, family })
		)
	);
}

test('pins the same validated DNS results into the connection without a second lookup', async () => {
	let calls = 0;
	const lookup = createPublicArchiveLookup((_hostname, options, callback) => {
		calls++;
		assert.equal(options.all, true);
		callback(null, [
			{ address: calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }
		]);
	});
	assert.deepEqual(await resolveThrough(lookup, 'archive.example'), {
		address: '8.8.8.8',
		family: 4
	});
	assert.equal(calls, 1);
	await assert.rejects(resolveThrough(lookup, 'archive.example'), {
		code: 'PUBLIC_ARCHIVE_POLICY'
	});
	assert.equal(calls, 2);
});

test('fails closed for mixed public/private answers, empty DNS and incompatible families', async () => {
	for (const records of [
		[],
		[
			{ address: '8.8.8.8', family: 4 },
			{ address: '10.0.0.1', family: 4 }
		],
		[{ address: '::ffff:127.0.0.1', family: 6 }]
	]) {
		const lookup = createPublicArchiveLookup((_hostname, _options, callback) =>
			callback(null, records)
		);
		await assert.rejects(
			resolveThrough(lookup, 'archive.example', { all: true }),
			{ code: 'PUBLIC_ARCHIVE_POLICY' }
		);
	}
	const lookup = createPublicArchiveLookup((_hostname, _options, callback) =>
		callback(null, [{ address: '8.8.8.8', family: 4 }])
	);
	await assert.rejects(
		resolveThrough(lookup, 'archive.example', { family: 6 }),
		{ code: 'PUBLIC_ARCHIVE_POLICY' }
	);
	assert.deepEqual(
		await resolveThrough(lookup, 'archive.example', { all: true }),
		{ address: [{ address: '8.8.8.8', family: 4 }], family: undefined }
	);
});

test('checks each redirect destination and keeps proxy/agents/redirect limits under policy ownership', () => {
	const config = publicArchiveRequestConfig({
		publicArchive: true,
		maxRedirects: 100,
		maxContentLength: 10_000_000
	});
	assert.equal(config.proxy, false);
	assert.equal(config.maxRedirects, 3);
	assert.equal(config.maxContentLength, 1024 * 1024);
	assert.equal(typeof config.httpAgent.options.lookup, 'function');
	assert.equal(typeof config.httpsAgent.options.lookup, 'function');
	for (const target of [
		{ protocol: 'http:', hostname: '127.0.0.1' },
		{ protocol: 'https:', hostname: '[::ffff:10.0.0.1]' },
		{ protocol: 'http:', hostname: '8.8.8.8', port: '8080' },
		{ protocol: 'https:', hostname: 'archive.example', auth: 'user:secret' }
	])
		assert.throws(() => config.beforeRedirect(target), {
			code: 'PUBLIC_ARCHIVE_POLICY'
		});
	validatePublicArchiveRedirect({
		protocol: 'http:',
		hostname: 'archive.example',
		port: 80
	});
	validatePublicArchiveRedirect({
		protocol: 'https:',
		hostname: '2606:4700::1111',
		port: 443
	});
	assert.equal(publicArchiveRequestConfig({ maxRedirects: 0 }).maxRedirects, 0);
	assert.equal(publicArchiveRequestConfig({ maxContentLength: 0 }).maxContentLength, 0);
	for (const field of ['maxRedirects', 'maxContentLength']) {
		for (const value of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			assert.throws(() => publicArchiveRequestConfig({ [field]: value }),
				{ code: 'PUBLIC_ARCHIVE_POLICY' });
			assert.throws(() => publicArchiveRequestConfig({ responseType: 'stream', [field]: value }),
				{ code: 'PUBLIC_ARCHIVE_POLICY' });
		}
	}
	assert.equal(
		publicArchiveRequestConfig({ maxContentLength: 65_536 }).maxContentLength,
		65_536
	);
});

test('preserves large archive streaming and identifies wrapped policy failures as worker policy', () => {
	const config = publicArchiveRequestConfig({ responseType: 'stream' });
	assert.equal(config.maxContentLength, undefined);
	assert.equal(
		isPublicArchivePolicyError({ cause: { code: 'PUBLIC_ARCHIVE_POLICY' } }),
		true
	);
	assert.equal(isPublicArchivePolicyError({ code: 'ERR_NETWORK' }), false);
	assert.throws(
		() =>
			publicArchiveRequestConfig({
				auth: { username: 'name', password: 'secret' }
			}),
		{ code: 'PUBLIC_ARCHIVE_POLICY' }
	);
});

const requestsByAgent = new WeakMap();

async function createLoopbackArchiveAgent(t, cap, onRequest = (_req, res) => res.end('ok'), protocol = 'http') {
	let nextSocketId = 0;
	const requests = [];
	const closed = new Set();
	const server = http.createServer((req, res) => {
		const socketId = req.socket.archiveTestSocketId;
		requests.push({ host: req.headers.host, method: req.method, path: req.url, socketId });
		res.setHeader('x-archive-test-socket', String(socketId));
		onRequest(req, res);
	});
	server.keepAliveTimeout = 60_000;
	server.on('connection', (socket) => {
		const socketId = ++nextSocketId;
		socket.archiveTestSocketId = socketId;
		socket.on('close', () => closed.add(socketId));
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const agent = publicArchiveRequestConfig({ publicArchive: true })[`${protocol}Agent`];
	const originalCreateConnection = agent.createConnection;
	const originalMaxTotalSockets = agent.maxTotalSockets;
	const originalMaxSockets = agent.maxSockets;
	const outstandingRequests = new Set();
	requestsByAgent.set(agent, outstandingRequests);
	agent.maxTotalSockets = cap;
	agent.maxSockets = cap;
	agent.createConnection = (_options, callback) =>
		net.connect(
			{ host: '127.0.0.1', port: server.address().port },
			callback
		);
	t.after(async () => {
		try {
			for (const req of outstandingRequests) req.destroy();
			agent.destroy();
			await waitUntil(() => outstandingRequests.size === 0);
		} finally {
			try {
				server.closeAllConnections();
				await new Promise((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve()))
				);
			} finally {
				agent.createConnection = originalCreateConnection;
				agent.maxTotalSockets = originalMaxTotalSockets;
				agent.maxSockets = originalMaxSockets;
				requestsByAgent.delete(agent);
			}
		}
	});
	return { agent, closed, requests, server };
}

function issueRequest(agent, port, hostname, path, requestHeaders = {}) {
	let resolveHeaders;
	let rejectHeaders;
	let resolveDone;
	let rejectDone;
	const headers = new Promise((resolve, reject) => {
		resolveHeaders = resolve;
		rejectHeaders = reject;
	});
	const done = new Promise((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	headers.catch(() => {});
	done.catch(() => {});
	const request = agent.protocol === 'https:' ? https.request : http.request;
	const req = request(
		{ hostname, port, path, method: 'GET', agent, headers: requestHeaders },
		(res) => {
			resolveHeaders({
				socket: res.socket,
				socketId: Number(res.headers['x-archive-test-socket']),
				statusCode: res.statusCode
			});
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.once('error', rejectDone);
			res.once('end', () =>
				resolveDone({
					body: Buffer.concat(chunks).toString(),
					socketId: Number(res.headers['x-archive-test-socket']),
					statusCode: res.statusCode
				})
			);
		}
	);
	req.once('error', (error) => {
		rejectHeaders(error);
		rejectDone(error);
	});
	requestsByAgent.get(agent)?.add(req);
	req.once('close', () => requestsByAgent.get(agent)?.delete(req));
	req.end();
	return { done, headers, req };
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for socket state');
		await new Promise((resolve) => setImmediate(resolve));
	}
}

function agentSocketCount(agent) {
	return ['sockets', 'freeSockets'].reduce(
		(total, key) =>
			total + Object.values(agent[key]).reduce((count, sockets) => count + sockets.length, 0),
		0
	);
}

function agentRequestCount(agent) {
	return Object.values(agent.requests).reduce(
		(total, requests) => total + requests.length,
		0
	);
}

test('reuses a keep-alive socket for sequential requests to one archive origin', { timeout: 4_000 }, async (t) => {
	const { agent, requests, server } = await createLoopbackArchiveAgent(t, 2);
	const port = server.address().port;
	const first = await issueRequest(agent, port, 'alpha.archive.example', '/first').done;
	const second = await issueRequest(agent, port, 'alpha.archive.example', '/second').done;
	assert.equal(first.socketId, second.socketId);
	assert.deepEqual(
		requests.map(({ host, method, path }) => ({ host, method, path })),
		[
			{ host: `alpha.archive.example:${port}`, method: 'GET', path: '/first' },
			{ host: `alpha.archive.example:${port}`, method: 'GET', path: '/second' }
		]
	);
});

test('evicts one foreign idle socket when a public archive pool is full', { timeout: 4_000 }, async (t) => {
	const { agent, closed, server } = await createLoopbackArchiveAgent(t, 2);
	const port = server.address().port;
	const alpha = await issueRequest(agent, port, 'alpha.archive.example', '/a').done;
	const beta = await issueRequest(agent, port, 'beta.archive.example', '/b').done;
	const gamma = await issueRequest(agent, port, 'gamma.archive.example', '/c').done;
	await waitUntil(() => closed.has(alpha.socketId) || closed.has(beta.socketId));
	assert.equal(Number(closed.has(alpha.socketId)) + Number(closed.has(beta.socketId)), 1);
	assert.equal(gamma.statusCode, 200);
	assert.ok(agentSocketCount(agent) <= 2);
	assert.equal(agentRequestCount(agent), 0);
});

test('preserves active archive sockets, same-origin liveness and cancellation at capacity', { timeout: 4_000 }, async (t) => {
	let held;
	const { agent, closed, server } = await createLoopbackArchiveAgent(
		t,
		1,
		(req, res) => {
			if (req.url === '/hold-one' || req.url === '/hold-two') {
				held = res;
				res.writeHead(200);
				res.write('open');
				return;
			}
			res.end('ok');
		}
	);
	const port = server.address().port;
	const alpha = issueRequest(agent, port, 'alpha.archive.example', '/hold-one');
	const alphaHeaders = await alpha.headers;
	const beta = issueRequest(agent, port, 'beta.archive.example', '/queued');
	const betaResponded = await Promise.race([
		beta.headers.then(() => true, () => true),
		delay(50).then(() => false)
	]);
	assert.equal(betaResponded, false);
	beta.req.destroy();
	const betaRejected = assert.rejects(beta.done);
	assert.equal(alphaHeaders.socket.destroyed, false);
	held.end('done');
	await alpha.done;
	await betaRejected;
	assert.equal((await issueRequest(agent, port, 'gamma.archive.example', '/after-cancel').done).statusCode, 200);

	// Clear the first cap-1 scenario before exercising active-plus-idle eviction at cap 2.
	agent.destroy();
	await waitUntil(() => agentSocketCount(agent) === 0);
	agent.maxTotalSockets = 2;
	agent.maxSockets = 2;
	held = undefined;
	const active = issueRequest(agent, port, 'alpha.archive.example', '/hold-two');
	const activeHeaders = await active.headers;
	const idleBeta = await issueRequest(agent, port, 'beta.archive.example', '/idle').done;
	const sameOrigin = await issueRequest(agent, port, 'alpha.archive.example', '/same-origin').done;
	await waitUntil(() => closed.has(idleBeta.socketId));
	assert.equal(activeHeaders.socket.destroyed, false);
	assert.equal(sameOrigin.statusCode, 200);
	const secondIdleBeta = await issueRequest(
		agent,
		port,
		'beta.archive.example',
		'/idle-again'
	).done;
	const gamma = await issueRequest(agent, port, 'gamma.archive.example', '/foreign').done;
	await waitUntil(() => closed.has(secondIdleBeta.socketId));
	assert.equal(gamma.statusCode, 200);
	assert.equal(activeHeaders.socket.destroyed, false);
	held.end('done');
	await active.done;
	assert.ok(agentSocketCount(agent) <= 2);
	assert.equal(agentRequestCount(agent), 0);
});

test('a cancelled request on a full idle pool leaves room for the next archive request', { timeout: 4_000 }, async (t) => {
	const { agent, server } = await createLoopbackArchiveAgent(t, 2);
	const port = server.address().port;
	await issueRequest(agent, port, 'alpha.archive.example', '/a').done;
	await issueRequest(agent, port, 'beta.archive.example', '/b').done;
	const gamma = issueRequest(agent, port, 'gamma.archive.example', '/cancel');
	gamma.req.destroy();
	await assert.rejects(gamma.done);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(agentRequestCount(agent), 0);
	assert.equal((await issueRequest(agent, port, 'delta.archive.example', '/d').done).statusCode, 200);
	assert.ok(agentSocketCount(agent) <= 2);
	assert.equal(agentRequestCount(agent), 0);

	// Refill the pool, then qualify native routing of a deferred connector throw.
	agent.destroy();
	await waitUntil(() => agentSocketCount(agent) === 0);
	await issueRequest(agent, port, 'alpha.archive.example', '/refill-a').done;
	await issueRequest(agent, port, 'beta.archive.example', '/refill-b').done;
	assert.equal(agentSocketCount(agent), 2);
	const loopbackCreateConnection = agent.createConnection;
	const expectedError = Object.assign(new Error('test connector failure'), {
		code: 'TEST_CONNECT_FAILURE'
	});
	agent.createConnection = () => {
		throw expectedError;
	};
	try {
		const failed = issueRequest(agent, port, 'gamma.archive.example', '/throws');
		await assert.rejects(failed.done, (error) => error === expectedError && error.code === 'TEST_CONNECT_FAILURE');
	} finally {
		agent.createConnection = loopbackCreateConnection;
	}
	await waitUntil(() => agentRequestCount(agent) === 0);
	assert.equal((await issueRequest(agent, port, 'delta.archive.example', '/after-throw').done).statusCode, 200);
	assert.ok(agentSocketCount(agent) <= 2);
	assert.equal(agentRequestCount(agent), 0);
});

test('preserves native HTTPS origin keys when a Host header supplies the TLS name', { timeout: 4_000 }, async (t) => {
	// The connector is deliberately loopback plaintext: this tests HTTPS Agent
	// key selection, not a TLS handshake or certificate verification.
	const { agent, closed, server } = await createLoopbackArchiveAgent(t, 2, undefined, 'https');
	const port = server.address().port;
	const headers = { host: 'tls-one.archive.example' };
	const first = await issueRequest(agent, port, 'alpha.archive.example', '/one', headers).done;
	await issueRequest(agent, port, 'beta.archive.example', '/fill').done;
	const repeated = await issueRequest(agent, port, 'alpha.archive.example', '/repeat', headers).done;
	assert.equal(repeated.socketId, first.socketId);
	assert.equal(closed.size, 0);
	const different = await issueRequest(
		agent, port, 'alpha.archive.example', '/different', { host: 'tls-two.archive.example' }
	).done;
	assert.notEqual(different.socketId, first.socketId);
	assert.ok(agentSocketCount(agent) <= 2);
	assert.equal(agentRequestCount(agent), 0);
});

test('preserves shared public HTTP and HTTPS agent caps', () => {
	const config = publicArchiveRequestConfig({ publicArchive: true });
	for (const agent of [config.httpAgent, config.httpsAgent]) {
		assert.equal(agent.maxSockets, 64);
		assert.equal(agent.maxFreeSockets, 32);
		assert.equal(agent.maxTotalSockets, 64);
	}
});
