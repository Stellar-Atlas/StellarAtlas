import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const domain = 'stellaratlas.io';
const events = new Map([
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
].map(([name, path]) => [name, { name, domain, url: `https://${domain}${path}` }]));
const bodyLimit = 512;

export function createAtlasIngress(collectorOrigin, send = fetch) {
	const collector = new URL(collectorOrigin);
	if (collector.protocol !== 'http:' || collector.hostname !== '127.0.0.1' ||
		collector.origin !== collectorOrigin) throw new Error('Use a loopback HTTP collector origin');
	const endpoint = new URL('/api/event', collector);
	let active = 0;
	let count = 0;
	let resetAt = 0;
	const server = createServer({
		requestTimeout: 3000, headersTimeout: 3000,
		connectionsCheckingInterval: 1000, maxHeaderSize: 4096
	}, async (request, response) => {
		const origin = request.headers.origin;
		const atlasBrowser = origin === 'https://stellaratlas.io' || origin === 'https://www.stellaratlas.io';
		const finish = status => {
			response.writeHead(status, {
				'Cache-Control': 'no-store', Connection: 'close', Vary: 'Origin',
				...(atlasBrowser ? { 'Access-Control-Allow-Origin': origin } : {})
			}).end();
		};
		if (request.url !== '/api/event') return finish(404);
		if (request.method !== 'POST') return finish(405);
		if (origin !== undefined && !atlasBrowser) return finish(403);
		if (/(?:^|,)\s*1\s*(?:,|$)/.test(request.headers['sec-gpc'] ?? '')) return finish(204);
		if (!['application/json', 'text/plain'].includes(request.headers['content-type']))
			return finish(415);
		if (Number(request.headers['content-length']) > bodyLimit) return finish(413);
		const now = Date.now();
		if (now >= resetAt) {
			count = 0;
			resetAt = now + 60_000;
		}
		if (active >= 4 || count >= 120) return finish(429);
		active++;
		count++;
		try {
			const chunks = [];
			let size = 0;
			for await (const chunk of request.iterator({ destroyOnReturn: false })) {
				size += chunk.length;
				if (size > bodyLimit) return finish(413);
				chunks.push(chunk);
			}
			let value;
			try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
			catch { return finish(400); }
			if (!value || typeof value !== 'object' || Array.isArray(value) ||
				Object.keys(value).length !== 3) return finish(400);
			const event = events.get(value.name);
			if (!event || value.domain !== event.domain || value.url !== event.url)
				return finish(400);
			const result = await send(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'User-Agent': 'StellarAtlasTelemetry/1.0' },
				body: JSON.stringify(event),
				redirect: 'error',
				signal: AbortSignal.timeout(1800)
			});
			await result.body?.cancel();
			return finish(result.status === 202 && result.headers.get('x-plausible-dropped') !== '1' ? 202 : 502);
		} catch {
			if (!response.destroyed && !response.headersSent) finish(502);
		} finally {
			active--;
		}
	});
	server.maxConnections = 32;
	return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const port = Number(process.env.ATLAS_ANALYTICS_INGRESS_PORT ?? '18081');
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ingress port');
	createAtlasIngress(process.env.ATLAS_ANALYTICS_COLLECTOR_ORIGIN ?? 'http://127.0.0.1:18080')
		.listen(port, '127.0.0.1');
}
