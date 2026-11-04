import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createAtlasIngress } from './ingress.mjs';

async function listen(server) {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return `http://127.0.0.1:${server.address().port}`;
}

const events = [
	['Documentation use', '/docs'],
	['Archive inspection', '/archives'],
	['Successful event query', '/explorer/contract-events']
].map(([name, path]) => ({ name, url: 'https://stellaratlas.io' + path, domain: 'stellaratlas.io' }));

test('reconstructs the three event shapes and rejects extraneous requests before forwarding', async () => {
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
				type: index === 2 ? 'application/json' : 'text/plain',
				headers: {
					...(index === 2 ? {} : { Origin: 'https://stellaratlas.io' }),
					'User-Agent': 'private-client',
					'X-Forwarded-For': '192.0.2.15',
					Authorization: 'Bearer fixture', Cookie: 'credential=fixture',
					Referer: 'https://stellaratlas.io/private?wallet=fixture'
				}
			});
			assert.equal(result.status, 202);
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
		assert.equal((await send({ ...events[0], extra: 'x'.repeat(512) })).status, 413);
		assert.equal(captured.length, 3);
		drop = true;
		assert.equal((await send(events[0])).status, 502);
	} finally {
		await Promise.all([ingress, collector].map(server => new Promise(resolve => server.close(resolve))));
	}
});
