import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import type { LookupAddress } from 'node:dns';

export interface SafeResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Buffer;
}

const requestTimeoutMs = 20_000;
const maxRedirects = 3;

export async function validatePublicHttpsUrl(rawUrl: string): Promise<URL> {
	const url = new URL(rawUrl);
	if (
		url.protocol !== 'https:' ||
		(url.port !== '' && url.port !== '443') ||
		url.username !== '' ||
		url.password !== ''
	) {
		throw new Error('Only public HTTPS URLs on port 443 are allowed');
	}
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host || host === 'localhost' || host.endsWith('.localhost')) {
		throw new Error('Private host is not allowed');
	}
	const addresses = isIp(host)
		? [{ address: host, family: host.includes(':') ? 6 : 4 }]
		: await lookup(host, { all: true, verbatim: true });
	if (
		addresses.length === 0 ||
		addresses.some((address) => !isPublicAddress(address.address))
	) {
		throw new Error('URL resolves to a non-public address');
	}
	return url;
}

export async function requestPublicHttps(
	rawUrl: string,
	headers: Readonly<Record<string, string>>,
	maxBytes: number
): Promise<SafeResponse> {
	let currentUrl = rawUrl;
	for (let redirects = 0; redirects <= maxRedirects; redirects++) {
		const url = await validatePublicHttpsUrl(currentUrl);
		const addresses = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''));
		const response = await requestOnce(url, headers, addresses, maxBytes);
		if (![301, 302, 303, 307, 308].includes(response.status)) {
			return response;
		}
		const location = response.headers.location;
		if (!location || redirects === maxRedirects) {
			throw new Error('Too many or invalid upstream redirects');
		}
		currentUrl = new URL(location, url).toString();
	}
	throw new Error('Too many upstream redirects');
}

async function resolvePublic(host: string): Promise<readonly LookupAddress[]> {
	const addresses = isIp(host)
		? [{ address: host, family: host.includes(':') ? 6 : 4 }]
		: await lookup(host, { all: true, verbatim: true });
	if (
		addresses.length === 0 ||
		addresses.some((value) => !isPublicAddress(value.address))
	) {
		throw new Error('URL resolves to a non-public address');
	}
	return addresses;
}

function requestOnce(
	url: URL,
	headers: Readonly<Record<string, string>>,
	addresses: readonly LookupAddress[],
	maxBytes: number
): Promise<SafeResponse> {
	return new Promise((resolve, reject) => {
		const pinned = addresses[0]!;
		const agent = new https.Agent({
			keepAlive: false,
			autoSelectFamily: false,
			lookup: (_hostname, _options, callback) =>
				callback(null, pinned.address, pinned.family)
		});
		const request = https.request(
			url,
			{
				headers: { 'user-agent': 'StellarAtlas-AssetMetadata/1.0', ...headers },
				agent,
				servername: url.hostname
			},
			(response) => {
				const status = response.statusCode ?? 0;
				const outputHeaders: Record<string, string> = {};
				for (const [key, value] of Object.entries(response.headers)) {
					if (typeof value === 'string')
						outputHeaders[key.toLowerCase()] = value;
				}
				const chunks: Buffer[] = [];
				let total = 0;
				response.on('data', (chunk: Buffer | string) => {
					const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					total += bytes.length;
					if (total > maxBytes) {
						request.destroy(new Error('Upstream response exceeds size limit'));
						return;
					}
					chunks.push(bytes);
				});
				response.on('end', () => {
					agent.destroy();
					resolve({
						status,
						headers: outputHeaders,
						body: Buffer.concat(chunks)
					});
				});
				response.on('error', (error) => {
					agent.destroy();
					reject(error);
				});
			}
		);
		request.setTimeout(requestTimeoutMs, () =>
			request.destroy(new Error('Upstream request timed out'))
		);
		request.on('error', (error) => {
			agent.destroy();
			reject(error);
		});
		request.end();
	});
}

function isIp(value: string): boolean {
	return isIP(value) !== 0;
}

function isPublicAddress(value: string): boolean {
	const host = value.toLowerCase();
	if (isIP(host) === 6) {
		if (host.startsWith('::ffff:')) return false;
		const firstSegment = Number.parseInt(host.split(':')[0] || '0', 16);
		return (
			(firstSegment & 0xe000) === 0x2000 &&
			!host.startsWith('2001:db8:') &&
			firstSegment !== 0x2002 &&
			!host.startsWith('2001:0:')
		);
	}
	if (isIP(host) !== 4) return false;
	const parts = host.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255))
		return false;
	const [a, b] = parts as [number, number, number, number];
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 255 && b === 255)
	);
}
