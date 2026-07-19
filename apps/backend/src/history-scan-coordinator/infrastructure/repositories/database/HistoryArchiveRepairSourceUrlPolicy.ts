import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeHistoryArchiveRootUrl } from 'shared';

const maximumUrlLength = 2_048;
const resolutionTimeoutMs = 2_000;
const blockedHostnameSuffixes = [
	'.home.arpa',
	'.internal',
	'.invalid',
	'.local',
	'.localhost',
	'.onion',
	'.test'
] as const;

export type HistoryArchiveRepairHostResolver = (
	hostname: string
) => Promise<readonly string[]>;

export type HistoryArchiveRepairSourceUrlPolicy = {
	requireObjectUrl(
		objectUrl: string | undefined,
		archiveUrl: string | undefined,
		archiveUrlIdentity: string | undefined
	): Promise<string>;
	resolveObjectUrl(
		objectUrl: string | undefined,
		archiveUrl: string | undefined,
		archiveUrlIdentity: string | undefined
	): Promise<HistoryArchiveRepairSourceUrlResolution>;
};

export interface HistoryArchiveRepairSourceUrlResolution {
	readonly addresses: readonly string[];
	readonly url: string;
}

export function createHistoryArchiveRepairSourceUrlPolicy(
	resolver: HistoryArchiveRepairHostResolver = resolveHostname
): HistoryArchiveRepairSourceUrlPolicy {
	const resolutions = new Map<string, Promise<readonly string[]>>();
	return {
		async requireObjectUrl(objectUrl, archiveUrl, archiveUrlIdentity) {
			return (
				await resolveObjectUrl(
					objectUrl,
					archiveUrl,
					archiveUrlIdentity,
					resolver,
					resolutions
				)
			).url;
		},
		async resolveObjectUrl(objectUrl, archiveUrl, archiveUrlIdentity) {
			return await resolveObjectUrl(
				objectUrl,
				archiveUrl,
				archiveUrlIdentity,
				resolver,
				resolutions
			);
		}
	};
}

async function resolveObjectUrl(
	objectUrl: string | undefined,
	archiveUrl: string | undefined,
	archiveUrlIdentity: string | undefined,
	resolver: HistoryArchiveRepairHostResolver,
	resolutions: Map<string, Promise<readonly string[]>>
): Promise<HistoryArchiveRepairSourceUrlResolution> {
	const object = parsePublicUrl(objectUrl, 'objectUrl');
	const archive = parsePublicUrl(archiveUrl, 'archiveUrl');
	requireArchiveIdentity(archiveUrl, archiveUrlIdentity);
	if (object.origin !== archive.origin) {
		throw new Error(
			'Verified repair source objectUrl is outside archive origin'
		);
	}
	requireArchivePath(object, archive);
	const addresses = await requirePublicResolution(
		object.hostname,
		resolver,
		resolutions
	);
	return { addresses, url: object.toString() };
}

function requireArchiveIdentity(
	archiveUrl: string | undefined,
	archiveUrlIdentity: string | undefined
): void {
	if (
		typeof archiveUrl !== 'string' ||
		typeof archiveUrlIdentity !== 'string' ||
		normalizeHistoryArchiveRootUrl(archiveUrl) !== archiveUrlIdentity
	) {
		throw new Error(
			'Verified repair source row has invalid archiveUrlIdentity'
		);
	}
}

function requireArchivePath(object: URL, archive: URL): void {
	const archivePath = archive.pathname.endsWith('/')
		? archive.pathname
		: `${archive.pathname}/`;
	if (
		object.pathname !== archive.pathname &&
		!object.pathname.startsWith(archivePath)
	) {
		throw new Error('Verified repair source objectUrl is outside archive root');
	}
}

function parsePublicUrl(value: string | undefined, field: string): URL {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maximumUrlLength ||
		value.trim() !== value ||
		/[\u0000-\u0020\u007f]/.test(value)
	) {
		throw new Error(`Verified repair source row has invalid ${field}`);
	}

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Verified repair source row has invalid ${field}`);
	}
	if (
		(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		parsed.search !== '' ||
		parsed.hash !== '' ||
		!isPublicHostnameSyntax(parsed.hostname)
	) {
		throw new Error(`Verified repair source row has invalid ${field}`);
	}
	return parsed;
}

async function requirePublicResolution(
	hostnameValue: string,
	resolver: HistoryArchiveRepairHostResolver,
	cache: Map<string, Promise<readonly string[]>>
): Promise<readonly string[]> {
	const hostname = stripIpv6Brackets(hostnameValue).toLowerCase();
	let pending = cache.get(hostname);
	if (pending === undefined) {
		pending = resolveAndValidate(hostname, resolver);
		cache.set(hostname, pending);
	}
	return await pending;
}

async function resolveAndValidate(
	hostname: string,
	resolver: HistoryArchiveRepairHostResolver
): Promise<readonly string[]> {
	const addresses =
		isIP(hostname) === 0 ? await resolver(hostname) : [hostname];
	if (
		addresses.length === 0 ||
		addresses.some((address) => !isPublicIp(address))
	) {
		throw new Error('Verified repair source resolves to a non-public address');
	}
	return addresses;
}

async function resolveHostname(hostname: string): Promise<readonly string[]> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			lookup(hostname, { all: true, verbatim: true }).then((addresses) =>
				addresses.map(({ address }) => address)
			),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error('Repair source DNS lookup timed out')),
					resolutionTimeoutMs
				);
				timeout.unref();
			})
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

function isPublicHostnameSyntax(value: string): boolean {
	const hostname = stripIpv6Brackets(value).toLowerCase();
	if (isIP(hostname) !== 0) return true;
	if (
		hostname.length > 253 ||
		!hostname.includes('.') ||
		!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
			hostname
		)
	) {
		return false;
	}
	return !blockedHostnameSuffixes.some(
		(suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
	);
}

function isPublicIp(value: string): boolean {
	const hostname = stripIpv6Brackets(value).toLowerCase();
	const version = isIP(hostname);
	if (version === 4) return isPublicIpv4(hostname);
	if (version === 6) return isPublicIpv6(hostname);
	return false;
}

function isPublicIpv4(hostname: string): boolean {
	const octets = hostname.split('.').map(Number);
	const first = octets[0] ?? -1;
	const second = octets[1] ?? -1;
	if (first <= 0 || first >= 224) return false;
	if (first === 10 || first === 127) return false;
	if (first === 100 && second >= 64 && second <= 127) return false;
	if (first === 169 && second === 254) return false;
	if (first === 172 && second >= 16 && second <= 31) return false;
	if (first === 192 && (second === 0 || second === 168)) return false;
	if (first === 198 && (second === 18 || second === 19 || second === 51)) {
		return false;
	}
	if (first === 203 && second === 0) return false;
	return true;
}

function isPublicIpv6(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe8') ||
		normalized.startsWith('fe9') ||
		normalized.startsWith('fea') ||
		normalized.startsWith('feb') ||
		normalized.startsWith('ff') ||
		normalized.startsWith('2001:db8:') ||
		normalized.startsWith('::ffff:')
	) {
		return false;
	}
	const firstGroup = normalized.split(':', 1)[0];
	if (firstGroup === undefined || firstGroup.length === 0) return false;
	const prefix = Number.parseInt(firstGroup, 16);
	return Number.isFinite(prefix) && prefix >= 0x2000 && prefix <= 0x3fff;
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith('[') && hostname.endsWith(']')
		? hostname.slice(1, -1)
		: hostname;
}
