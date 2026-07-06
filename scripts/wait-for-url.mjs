import http from 'node:http';
import https from 'node:https';

const [url, timeoutSeconds = '60'] = process.argv.slice(2);

if (!url) {
	console.error('Usage: node scripts/wait-for-url.mjs <url> [timeoutSeconds]');
	process.exit(2);
}

const timeoutMs = Number(timeoutSeconds) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
	console.error('timeoutSeconds must be a positive number');
	process.exit(2);
}

const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
	if (await isReady(url)) process.exit(0);
	await sleep(1000);
}

console.error(`Timed out waiting for ${url}`);
process.exit(1);

function isReady(targetUrl) {
	return new Promise((resolve) => {
		const client = targetUrl.startsWith('https:') ? https : http;
		const request = client.get(targetUrl, { timeout: 2000 }, (response) => {
			response.resume();
			resolve(response.statusCode >= 200 && response.statusCode < 400);
		});
		request.on('timeout', () => {
			request.destroy();
			resolve(false);
		});
		request.on('error', () => resolve(false));
	});
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
