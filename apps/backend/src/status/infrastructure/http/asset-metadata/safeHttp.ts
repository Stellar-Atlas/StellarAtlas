import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import https from 'node:https';
import type { LookupAddress } from 'node:dns';

export interface SafeResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Buffer;
}

const requestTimeoutMs = 20_000;
const maxRedirects = 3;

// Exclude IANA special-purpose ranges, even their globally reachable anycast assignments.
// https://www.iana.org/assignments/iana-ipv4-special-registry
// https://www.iana.org/assignments/iana-ipv6-special-registry
const specialUse = new BlockList();
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.31.196.0', 24],
	['192.52.193.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['192.175.48.0', 24],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const)
	specialUse.addSubnet(address, prefix, 'ipv4');

const globalUnicastV6 = new BlockList();
globalUnicastV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['2620:4f:8000::', 48],
	['3ffe::', 16],
	['3fff::', 20]
] as const)
	specialUse.addSubnet(address, prefix, 'ipv6');

function parsePublicHttpsUrl(rawUrl: string): URL {
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
	return url;
}

export async function validatePublicHttpsUrl(rawUrl: string): Promise<URL> {
	const url = parsePublicHttpsUrl(rawUrl);
	await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''));
	return url;
}

export async function requestPublicHttps(
	rawUrl: string,
	headers: Readonly<Record<string, string>>,
	maxBytes: number,
	options: {
		readonly signal?: AbortSignal;
		readonly followRedirects?: boolean;
	} = {}
): Promise<SafeResponse> {
	let currentUrl = rawUrl;
	for (let redirects = 0; redirects <= maxRedirects; redirects++) {
		const url = parsePublicHttpsUrl(currentUrl);
		const addresses = await resolvePublic(
			url.hostname.replace(/^\[|\]$/g, ''),
			options.signal
		);
		const response = await requestOnce(
			url,
			headers,
			addresses,
			maxBytes,
			options.signal
		);
		if (
			options.followRedirects === false ||
			![301, 302, 303, 307, 308].includes(response.status)
		) {
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

async function resolvePublic(
	host: string,
	signal?: AbortSignal
): Promise<readonly LookupAddress[]> {
	signal?.throwIfAborted();
	const addresses = isIp(host)
		? [{ address: host, family: host.includes(':') ? 6 : 4 }]
		: await lookupWithDeadline(host, signal);
	if (
		addresses.length === 0 ||
		addresses.some((value) => !isPublicAddress(value.address))
	) {
		throw new Error('URL resolves to a non-public address');
	}
	return addresses;
}

async function lookupWithDeadline(host: string, signal?: AbortSignal) {
	const pending = lookup(host, { all: true, verbatim: true });
	if (!signal) return pending;
	let abort!: () => void;
	const interrupted = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
	});
	try {
		return await Promise.race([pending, interrupted]);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}

function requestOnce(
	url: URL,
	headers: Readonly<Record<string, string>>,
	addresses: readonly LookupAddress[],
	maxBytes: number,
	signal?: AbortSignal
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
				signal,
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
	const family = isIP(value);
	if (family === 4) return !specialUse.check(value, 'ipv4');
	return (
		family === 6 &&
		globalUnicastV6.check(value, 'ipv6') &&
		!specialUse.check(value, 'ipv6')
	);
}
