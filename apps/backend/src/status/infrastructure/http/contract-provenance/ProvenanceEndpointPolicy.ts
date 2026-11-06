import { lookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const nativeLocalRpc = 'http://127.0.0.1:8002/';
const approvedEndpoint = Symbol('approvedEndpoint');
const issuedEndpoints = new WeakSet<RpcEndpoint>();
export type RpcEndpoint<
	Scope extends 'native' | 'scoped' = 'native' | 'scoped'
> = Readonly<{
	[approvedEndpoint]: true;
	scope: Scope;
	href: string;
	protocol: 'http:' | 'https:';
	lookup?: LookupFunction;
}>;

function blockList(
	family: 'ipv4' | 'ipv6',
	cidrs: readonly (readonly [string, number])[]
) {
	const list = new BlockList();
	for (const [address, prefix] of cidrs)
		list.addSubnet(address, prefix, family);
	return list;
}

const nonPublicV4 = blockList('ipv4', [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['168.63.129.16', 32],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 3]
]);
const globalV6 = blockList('ipv6', [['2000::', 3]]);
const specialV6 = blockList('ipv6', [
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['3fff::', 20]
]);
const privateV4 = blockList('ipv4', [
	['10.0.0.0', 8],
	['127.0.0.0', 8],
	['172.16.0.0', 12],
	['192.168.0.0', 16]
]);
const privateV6 = blockList('ipv6', [
	['::1', 128],
	['fc00::', 7]
]);

function privateIp(address: string): boolean {
	const family = isIP(address);
	return (
		(family === 4 && privateV4.check(address, 'ipv4')) ||
		(family === 6 && privateV6.check(address, 'ipv6'))
	);
}

function publicIp(address: string, family: number): boolean {
	if (family === 4 && isIP(address) === 4)
		return !nonPublicV4.check(address, 'ipv4');
	return (
		family === 6 &&
		isIP(address) === 6 &&
		!address.includes('%') &&
		globalV6.check(address, 'ipv6') &&
		!specialV6.check(address, 'ipv6')
	);
}

// Node uses the returned address for this socket; TLS still authenticates the
// configured hostname. Refuse mixed public/private results, and return just
// one address so dual-stack connection fallback cannot retry to another peer.
type ResolveEndpoint = (
	host: string,
	callback: (
		error: NodeJS.ErrnoException | null,
		answers: { address: string; family: number }[]
	) => void
) => void;

function checkedLookup(
	expectedHost: string,
	admit: (address: string, family: number) => boolean,
	resolve: ResolveEndpoint = (host, callback) =>
		lookup(host, { all: true }, callback)
): LookupFunction {
	return (host, options, callback) => {
		const deny = () =>
			callback(new Error('Disallowed endpoint address'), '', 0);
		if (host !== expectedHost) return deny();
		resolve(host, (error, answers) => {
			if (error) return callback(error, '', 0);
			if (
				answers.length === 0 ||
				answers.some(({ address, family }) => !admit(address, family))
			)
				return deny();
			const peer = answers.find(
				({ family }) => !options.family || family === options.family
			);
			if (!peer) return deny();
			if (options.all) callback(null, [peer]);
			else callback(null, peer.address, peer.family);
		});
	};
}

export function publicEndpointLookup(
	expectedHost: string,
	resolve?: ResolveEndpoint
) {
	return checkedLookup(expectedHost, publicIp, resolve);
}

export function privateEndpointLookup(
	expectedHost: string,
	pinnedAddress: string,
	resolve?: ResolveEndpoint
) {
	const family = isIP(pinnedAddress);
	const canonical = canonicalIp(pinnedAddress);
	return checkedLookup(
		expectedHost,
		(address, actualFamily) =>
			privateIp(pinnedAddress) &&
			actualFamily === family &&
			canonicalIp(address) === canonical,
		resolve
	);
}

function canonicalIp(address: string): string | undefined {
	const family = isIP(address);
	if (family === 4) return address;
	if (family === 6 && !address.includes('%'))
		return new URL('https://[' + address + ']/').hostname;
	return undefined;
}

function parseEndpoint(raw: string | undefined): URL | undefined {
	if (
		!raw ||
		raw.length > 512 ||
		!/^https?:\/\/(?:\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::[1-9]\d{0,4})?(?:\/[a-zA-Z0-9/._~-]*)?$/.test(
			raw
		)
	)
		return undefined;
	try {
		const url = new URL(raw);
		if (raw !== url.href && raw + '/' !== url.href) return undefined;
		if (url.pathname.includes('//')) return undefined;
		const host = hostname(url);
		if (
			isIP(host) === 0 &&
			!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
				host
			)
		)
			return undefined;
		return url;
	} catch {
		return undefined;
	}
}

const hostname = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

function select<Scope extends 'native' | 'scoped'>(
	configured: string | undefined,
	approved: string | undefined,
	scope: Scope,
	pinnedAddress?: string
): RpcEndpoint<Scope> | undefined {
	const requested = parseEndpoint(configured);
	const endpoint = parseEndpoint(approved);
	if (!requested || !endpoint || requested.href !== endpoint.href)
		return undefined;
	const host = hostname(endpoint);
	const family = isIP(host);
	const privatePin =
		scope === 'native' && family === 0 && pinnedAddress !== undefined;
	if (privatePin && (!privateIp(pinnedAddress) || !canonicalIp(pinnedAddress)))
		return undefined;
	const intentionalPrivate =
		scope === 'native' && (privateIp(host) || privatePin);
	if (
		!intentionalPrivate &&
		(endpoint.protocol !== 'https:' ||
			(family === 0 ? !host.includes('.') : !publicIp(host, family)))
	)
		return undefined;
	const capability: RpcEndpoint<Scope> = Object.freeze({
		[approvedEndpoint]: true as const,
		scope,
		href: endpoint.href,
		protocol: endpoint.protocol === 'http:' ? 'http:' : 'https:',
		lookup: privatePin
			? privateEndpointLookup(host, pinnedAddress)
			: family === 0
				? publicEndpointLookup(host)
				: undefined
	});
	issuedEndpoints.add(capability);
	return capability;
}

export function nativeRpcEndpoint(
	configured?: string,
	approved = process.env.STELLAR_NATIVE_RPC_APPROVED_URL,
	privateAddress = process.env.STELLAR_NATIVE_RPC_APPROVED_PRIVATE_IP
): RpcEndpoint<'native'> | undefined {
	return select(
		configured,
		approved ?? nativeLocalRpc,
		'native',
		privateAddress
	);
}

export function scopedRpcEndpoint(
	configured: string,
	approved = process.env.STELLAR_PROVENANCE_RPC_APPROVED_URL
): RpcEndpoint<'scoped'> | undefined {
	return select(configured, approved, 'scoped');
}

export function isRpcEndpoint(value: RpcEndpoint): boolean {
	return issuedEndpoints.has(value);
}
