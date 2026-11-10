import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const home = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StellarAtlas Analytics</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}
main{max-width:42rem;margin:3rem auto;padding:1rem}
li{margin-block:1rem}
a{color:LinkText;text-underline-offset:.2em}
</style></head><body><main>
<h1>StellarAtlas Analytics</h1>
<ul>
<li><a href="/stellaratlas.io">Website analytics</a> for pageviews and site activity in Plausible.</li>
<li><a href="/api-traffic">API traffic</a> for origin requests, HTTP outcomes, and WebSocket handshakes.</li>
</ul>
</main></body></html>\n`;

const maxPageBytes = 128 * 1024;
const socketPath = '/run/atlas-analytics-api-traffic/report.sock';
const reportPath = '/srv/stellaratlas/analytics-data/api-traffic/index.html';
const headers = {
	'Cache-Control': 'private, no-store',
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff'
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
	response.writeHead(status, {
		...headers,
		'Content-Type': type,
		'Content-Length': Buffer.byteLength(body)
	});
	response.end(body);
}

async function snapshot(path) {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size < 1 || stat.size > maxPageBytes) throw new Error('Invalid report snapshot');
		const body = Buffer.alloc(stat.size);
		const { bytesRead } = await file.read(body);
		if (bytesRead !== stat.size) throw new Error('Incomplete report snapshot');
		return body;
	} finally {
		await file.close();
	}
}

export function createDashboardServer(reportPath) {
	const server = createServer({
		requestTimeout: 5_000,
		headersTimeout: 3_000,
		keepAliveTimeout: 2_000,
		maxHeaderSize: 8 * 1024
	}, async (request, response) => {
		if (request.url !== '/' && request.url !== '/api-traffic') {
			send(response, 404, 'Not found.\n');
			return;
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.setHeader('Allow', 'GET, HEAD');
			send(response, 405, 'Method not allowed.\n');
			return;
		}
		if (request.headers['transfer-encoding'] || (request.headers['content-length'] ?? '0') !== '0') {
			response.setHeader('Connection', 'close');
			send(response, 400, 'Request body is not allowed.\n');
			return;
		}
		try {
			const page = request.url === '/' ? home : await snapshot(reportPath);
			send(response, 200, page, 'text/html; charset=utf-8');
		} catch {
			send(response, 503, 'The API traffic snapshot is temporarily unavailable.\n');
		}
	});
	server.maxConnections = 32;
	server.setTimeout(5_000, socket => socket.destroy());
	return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	process.umask(0o177);
	const server = createDashboardServer(reportPath);
	server.once('error', () => {
		console.error('API traffic origin could not bind its socket.');
		process.exitCode = 1;
	});
	server.listen(socketPath);
	process.once('SIGTERM', () => server.close());
	process.once('SIGINT', () => server.close());
}
