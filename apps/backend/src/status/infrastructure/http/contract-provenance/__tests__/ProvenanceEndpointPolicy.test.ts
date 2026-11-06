import type { LookupFunction } from 'node:net';
import {
	nativeRpcEndpoint,
	privateEndpointLookup,
	publicEndpointLookup,
	scopedRpcEndpoint
} from '../ProvenanceEndpointPolicy.js';

const scoped = 'https://rpc.example.invalid:8443/soroban/rpc';

it('requires separate selection and approval and preserves exact native prefixes', () => {
	const loopback = 'http://127.0.0.1:8002';
	const custom = 'http://192.168.2.4:9123/stellar/rpc/';
	const pinnedName = 'http://stellar-rpc:9123/stellar/rpc/';
	expect(nativeRpcEndpoint(undefined)).toBeUndefined();
	expect(nativeRpcEndpoint(loopback)?.href).toBe(loopback + '/');
	expect(nativeRpcEndpoint(custom)).toBeUndefined();
	expect(nativeRpcEndpoint(custom, custom)).toMatchObject({
		href: custom,
		protocol: 'http:',
		scope: 'native'
	});
	expect(nativeRpcEndpoint(pinnedName, pinnedName)).toBeUndefined();
	expect(
		nativeRpcEndpoint(pinnedName, pinnedName, '192.168.2.4')?.lookup
	).toEqual(expect.any(Function));
	expect(
		nativeRpcEndpoint(pinnedName, pinnedName, '169.254.169.254')
	).toBeUndefined();
	expect(
		nativeRpcEndpoint('http://[::1]:9001/rpc', 'http://[::1]:9001/rpc')
	).toMatchObject({ protocol: 'http:', scope: 'native' });
	expect(nativeRpcEndpoint(scoped, scoped)?.lookup).toEqual(
		expect.any(Function)
	);
	expect(scopedRpcEndpoint(scoped)).toBeUndefined();
	expect(scopedRpcEndpoint(scoped, scoped + '/')).toBeUndefined();
	expect(scopedRpcEndpoint(scoped, scoped)).toMatchObject({
		href: scoped,
		protocol: 'https:',
		scope: 'scoped'
	});
});

it.each([
	'https://rpc.example.invalid@other.example.invalid/',
	'https://@rpc.example.invalid/',
	'https://rpc.example.invalid/?token=x',
	'https://rpc.example.invalid/#',
	'https://rpc.example.invalid/ok/../rpc',
	'https://rpc.example.invalid/%2e%2e/rpc',
	'https://rpc.example.invalid//rpc',
	'https://rpc.example.invalid:0443/rpc',
	'https://rpc.example.invalid./rpc',
	'https://rpc.example.invalid\\@other.example.invalid/rpc',
	'https://127.1/rpc',
	'https://0x7f000001/rpc',
	'https://2130706433/rpc',
	'https://0177.0.0.1/rpc',
	'https://[::ffff:7f00:1]/rpc',
	'https://169.254.169.254/rpc'
])('rejects ambiguous or unsafe URL %s in both modes', (url) => {
	expect(nativeRpcEndpoint(url, url)).toBeUndefined();
	expect(scopedRpcEndpoint(url, url)).toBeUndefined();
});

function callLookup(fn: LookupFunction, host = 'rpc.example.invalid') {
	return new Promise<unknown>((resolve, reject) => {
		fn(host, { all: true }, (error, addresses) => {
			if (error) reject(error);
			else resolve(addresses);
		});
	});
}

it('pins one checked public peer to each socket and refuses a later mixed or rebound answer', async () => {
	const publicAnswer = { address: '8.8.8.8', family: 4 };
	let answers = [publicAnswer, { address: '2606:4700:4700::1111', family: 6 }];
	const lookup = publicEndpointLookup('rpc.example.invalid', (_host, done) =>
		done(null, answers)
	);
	await expect(callLookup(lookup)).resolves.toEqual([publicAnswer]);
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'169.254.169.254',
		'168.63.129.16',
		'100.64.0.1',
		'::ffff:127.0.0.1',
		'fe80::1',
		'fd00::1',
		'::1',
		'2002:7f00:1::1'
	]) {
		answers = [
			publicAnswer,
			{ address, family: address.includes(':') ? 6 : 4 }
		];
		await expect(callLookup(lookup)).rejects.toThrow(
			'Disallowed endpoint address'
		);
	}
	await expect(callLookup(lookup, 'other.example.invalid')).rejects.toThrow(
		'Disallowed endpoint address'
	);
});

it('allows only the independently pinned native private DNS peer', async () => {
	let address = '10.2.3.4';
	const lookup = privateEndpointLookup(
		'rpc.example.invalid',
		address,
		(_host, done) => done(null, [{ address, family: 4 }])
	);
	await expect(callLookup(lookup)).resolves.toEqual([{ address, family: 4 }]);
	address = '10.2.3.5';
	await expect(callLookup(lookup)).rejects.toThrow(
		'Disallowed endpoint address'
	);
});
