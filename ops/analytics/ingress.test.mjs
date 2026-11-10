import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createAtlasIngress } from './ingress.mjs';
import { collectEdgeTraffic, edgeQuery, edgeWindow, readEdgeState } from './edge-traffic.mjs';
import { filterJournal, publicRoutes, renderEdgeTraffic } from './render-api-traffic.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('traffic report includes only documented templates and fixed fallback labels', () => {
	const labels = publicRoutes({ paths: { '/v1/check': { get: {}, options: {} } } });
	const from = '2026-11-10T00:00:00.000Z', to = '2026-11-10T00:01:00.000Z';
	const input = JSON.stringify({ type: 'atlas_public_api_traffic_v1', from, to, httpScope: 'all_express_requests',
		http: { UNMATCHED_ROUTE: { '4xx': 2 }, UNSUPPORTED_METHOD: { aborted: 1 },
			INVALID_PATH: { '4xx': 3 }, 'OPTIONS /v1/check': { '2xx': 4 },
			'GET /private-account': { '2xx': 20 } } });
	const filtered = filterJournal(input, labels);
	assert.equal(filtered[0].rejected, 1);
	assert.doesNotMatch(filtered[0].line, /private-account/);
	const reader = spawnSync(process.execPath, [fileURLToPath(new URL('./read-api-traffic.mjs', import.meta.url)), from, to],
		{ input: filtered[0].line, encoding: 'utf8' });
	assert.equal(reader.status, 0, reader.stderr ?? String(reader.error));
	const report = JSON.parse(reader.stdout);
	assert.equal(report.outcomes['4xx'], 5);
	assert.equal(report.outcomes['2xx'], 4);
	assert.equal(report.outcomes.aborted, 1);
	assert.equal(report.coverage.inputLimited, false);
	assert.equal(report.coverage.allRequestWindows, 1);
	assert.equal(report.coverage.legacyRouteOnlyWindows, 0);
});

test('traffic edge adapter preserves provider counts and never treats missing data as zero', async () => {
	const now = Date.parse('2026-11-10T22:20:19.558Z');
	const window = edgeWindow(now);
	assert.equal(window.to, '2026-11-10T22:10:00.000Z');
	assert.equal(window.from, '2026-11-09T22:10:00.000Z');
	assert.match(edgeQuery('a'.repeat(32), window), /requestSource:"eyeball"/);
	assert.match(edgeQuery('a'.repeat(32), window), /sources:httpRequestsAdaptiveGroups\(limit:16/);
	assert.doesNotMatch(edgeQuery('a'.repeat(32), window), /clientIP|RequestPath|workersInvocations/);
	const payload = { data: { viewer: { zones: [{
		total: [{ count: 27, avg: { sampleInterval: 2 } }],
		breakdown: [{ count: 21, avg: { sampleInterval: 2 },
			dimensions: { clientRequestHTTPHost: 'private-token.stellaratlas.io', edgeResponseStatus: 200, cacheStatus: 'dynamic' } }],
		sources: [{ count: 27, avg: { sampleInterval: 2 }, dimensions: { requestSource: 'eyeball' } },
			{ count: 5, avg: { sampleInterval: 1 }, dimensions: { requestSource: 'inBrowserChallenge' } },
			{ count: 43, avg: { sampleInterval: 1 }, dimensions: { requestSource: 'edgeWorkerFetch' } }]
	}] } } };
	const send = async (url, options) => {
		assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
		assert.equal(options.redirect, 'error');
		return Response.json(payload);
	};
	const snapshot = await collectEdgeTraffic('a'.repeat(32), 'fixture-token-never-persisted', send, now);
	assert.equal(snapshot.edge.providerCount, 27);
	assert.equal(snapshot.edge.groups[0].host, 'other-zone-host');
	assert.doesNotMatch(JSON.stringify(snapshot), /private-token|fixture-token/);
	const html = renderEdgeTraffic({ state: 'ready', lastGood: snapshot }, new Date(now).toISOString());
	assert.match(html, /27 provider-reported/);
	assert.match(html, /not multiplied/);
	assert.match(html, /inBrowserChallenge/);
	assert.match(html, /edgeWorkerFetch/);
	assert.equal(snapshot.edge.providerCount, 27); // Never 27 + 5 + 43.
	assert.match(renderEdgeTraffic({ state: 'error', lastGood: snapshot }, new Date(now).toISOString()), /last measured window/);
	assert.match(renderEdgeTraffic(undefined, new Date(now).toISOString()), /Not yet collecting/);
	assert.match(renderEdgeTraffic({ state: 'unavailable' }, new Date(now).toISOString()), /not zero traffic/);
	assert.equal(readEdgeState('/nonexistent-atlas-edge-snapshot').state, 'not_collecting');
	await assert.rejects(collectEdgeTraffic('a'.repeat(32), 'fixture-token-never-persisted',
		async () => Response.json({ errors: [{ message: 'private provider details' }] }), now));
	await assert.rejects(collectEdgeTraffic('a'.repeat(32), 'fixture-token-never-persisted',
		async () => Response.json({ data: { viewer: { zones: [{ total: [], breakdown: [] }] } } }), now));
	await assert.rejects(collectEdgeTraffic('a'.repeat(32), 'fixture-token-never-persisted',
		async () => new Response('x'.repeat(65537)), now));
});

async function listen(server) {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return `http://127.0.0.1:${server.address().port}`;
}

const events = [
	['Documentation use', '/docs'],
	['Archive inspection', '/archives'],
	['Network view', '/overview'],
	['Explorer list view', '/explorer'],
	['Explorer record view', '/explorer'],
	['Explorer search submitted', '/explorer'],
	['Successful event query', '/explorer/contract-events'],
	['Public REST use', '/docs/api'],
	['Public GraphQL use', '/docs/graphql'],
	['Public WebSocket connection', '/docs/live-updates']
].map(([name, path]) => ({ name, url: 'https://stellaratlas.io' + path, domain: 'stellaratlas.io' }));

test('reconstructs every allowed event and drops private or extraneous requests before forwarding', async () => {
	const captured = [];
	let drop = false;
	const collector = createServer(async (request, response) => {
		let body = '';
		for await (const chunk of request) body += chunk;
		captured.push({ url: request.url, body: JSON.parse(body), headers: request.headers });
		response.writeHead(202, drop ? { 'x-plausible-dropped': '1' } : {}).end();
	});
	const ingress = createAtlasIngress(await listen(collector));
	const origin = await listen(ingress);
	const send = (body, options = {}) => fetch(origin + (options.path ?? '/api/event'), {
		method: 'POST', body: JSON.stringify(body),
		headers: { 'Content-Type': options.type ?? 'text/plain', ...options.headers },
		signal: AbortSignal.timeout(3000)
	});
	try {
		for (const [index, event] of events.entries()) {
			const result = await send(event, {
				type: index >= 6 ? 'application/json' : 'text/plain',
				headers: {
					...(index >= 6 ? {} : { Origin: 'https://stellaratlas.io' }),
					'User-Agent': 'private-client',
					'X-Forwarded-For': '192.0.2.15',
					Authorization: 'Bearer fixture', Cookie: 'credential=fixture',
					Referer: 'https://stellaratlas.io/private?wallet=fixture'
				}
			});
			assert.equal(result.status, 202);
			assert.equal(result.headers.get('access-control-allow-origin'),
				index >= 6 ? null : 'https://stellaratlas.io');
			assert.equal(result.headers.get('vary'), 'Origin');
		}
		assert.deepEqual(captured.map(x => x.body), events);
		for (const { url, headers } of captured) {
			assert.equal(url, '/api/event');
			assert.equal(headers['user-agent'], 'StellarAtlasTelemetry/1.0');
			for (const key of ['x-forwarded-for', 'authorization', 'cookie', 'referer', 'origin'])
				assert.equal(headers[key], undefined);
		}
		assert.equal((await send({ ...events[0], props: { wallet: 'fixture' } })).status, 400);
		assert.equal((await send({ ...events[0], name: 'Unknown' })).status, 400);
		assert.equal((await send({ ...events[0], url: events[0].url + '?wallet=fixture' })).status, 400);
		assert.equal((await send({ ...events[0], domain: 'other.example.test' })).status, 400);
		assert.equal((await send(events[0], { path: '/api/event?query=fixture' })).status, 404);
		assert.equal((await send(events[0], { headers: { Origin: 'https://other.example.test' } })).status, 403);
		assert.equal((await send(events[0], { headers: { Origin: 'null' } })).status, 403);
		assert.equal((await send({ ...events[0], extra: 'x'.repeat(512) })).status, 413);
		assert.equal((await send(events[0], { headers: { 'Sec-GPC': '0, 1' } })).status, 204);
		assert.equal(captured.length, events.length);
		drop = true;
		assert.equal((await send(events[0])).status, 502);
	} finally {
		await Promise.all([ingress, collector].map(server => new Promise(resolve => server.close(resolve))));
	}
});
