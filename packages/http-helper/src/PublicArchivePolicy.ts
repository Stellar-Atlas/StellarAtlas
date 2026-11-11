import { lookup, type LookupAddress } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { AxiosRequestConfig } from 'axios';
import type { HttpOptions } from './HttpService.js';

export const publicArchivePolicyErrorCode = 'PUBLIC_ARCHIVE_POLICY';
const maximumStateBytes = 1024 * 1024;
const maximumRedirects = 3;
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
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['2620:4f:8000::', 48],
	['3ffe::', 16],
	['3fff::', 20]
] as const)
	specialUse.addSubnet(address, prefix, 'ipv6');

function policyError(): NodeJS.ErrnoException {
	const error: NodeJS.ErrnoException = new Error(
		'Archive destination refused by public-address policy'
	);
	error.code = publicArchivePolicyErrorCode;
	return error;
}

export function isPublicArchiveAddress(address: string): boolean {
	const family = isIP(address);
	return family === 4
		? !specialUse.check(address, 'ipv4')
		: family === 6 &&
				globalV6.check(address, 'ipv6') &&
				!specialUse.check(address, 'ipv6');
}

/** Runs in the connection's lookup, not a preflight followed by a second DNS lookup. */
export function createPublicArchiveLookup(
	resolve: typeof lookup = lookup
): LookupFunction {
	return (hostname, options, callback) => {
		resolve(
			hostname,
			{ all: true, verbatim: true },
			(error, addresses: LookupAddress[]) => {
				if (error) return callback(error, '');
				if (
					!addresses.length ||
					addresses.some(({ address }) => !isPublicArchiveAddress(address))
				)
					return callback(policyError(), '');
				const allowed = addresses.filter(
					({ family }) => !options.family || options.family === family
				);
				if (!allowed.length) return callback(policyError(), '');
				if (options.all) return callback(null, allowed);
				callback(null, allowed[0]!.address, allowed[0]!.family);
			}
		);
	};
}

const agentOptions = {
	keepAlive: true,
	maxFreeSockets: 32,
	maxSockets: 64,
	maxTotalSockets: 64,
	lookup: createPublicArchiveLookup()
};
const publicHttpAgent = new HttpAgent(agentOptions);
const publicHttpsAgent = new HttpsAgent(agentOptions);

export function requirePublicArchiveUrl(value: string): URL {
	if (/[\\\s\p{Cc}]/u.test(value)) throw policyError();
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw policyError();
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.port !== '' ||
		url.username ||
		url.password ||
		url.hash ||
		!hostname ||
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		(isIP(hostname) !== 0 && !isPublicArchiveAddress(hostname))
	)
		throw policyError();
	return url;
}

/** follow-redirects calls this before each connection, including literal-IP hops. */
export function validatePublicArchiveRedirect(options: {
	readonly protocol?: string;
	readonly hostname?: string;
	readonly port?: string | number;
	readonly auth?: string;
}): void {
	if (!options.hostname || options.auth) throw policyError();
	const host =
		options.hostname.includes(':') && !options.hostname.startsWith('[')
			? '[' + options.hostname + ']'
			: options.hostname;
	requirePublicArchiveUrl(
		`${options.protocol}//${host}${options.port ? ':' + options.port : ''}/`
	);
}

export function publicArchiveRequestConfig(
	options: HttpOptions
): AxiosRequestConfig {
	if (options.auth) throw policyError();
	const maxRedirects = boundedLimit(options.maxRedirects, maximumRedirects);
	const maxContentLength = boundedLimit(options.maxContentLength, maximumStateBytes);
	return {
		proxy: false,
		httpAgent: publicHttpAgent,
		httpsAgent: publicHttpsAgent,
		beforeRedirect: validatePublicArchiveRedirect,
		maxRedirects,
		// JSON/state/listing responses are small; binary archives remain streaming.
		...(options.responseType === 'stream'
			? {}
			: { maxContentLength })
	};
}

function boundedLimit(value: number | undefined, maximum: number): number {
	if (value === undefined) return maximum;
	if (!Number.isSafeInteger(value) || value < 0) throw policyError();
	return Math.min(value, maximum);
}

export function isPublicArchivePolicyError(error: unknown): boolean {
	for (
		let depth = 0;
		depth < 5 && typeof error === 'object' && error !== null;
		depth++
	) {
		if ('code' in error && error.code === publicArchivePolicyErrorCode)
			return true;
		error = 'cause' in error ? error.cause : undefined;
	}
	return false;
}
