import { Address, Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import {
	decodeRegistryRecord,
	exactDomainName,
	REGISTRY_V2,
	registryRecordKey
} from '../SorobanDomainRecord.js';

const rpcRequest = jest.fn<
	Promise<unknown>,
	[URL, { method: string; params?: object }]
>();
const moduleJest = (
	import.meta as ImportMeta & {
		jest: { unstable_mockModule(name: string, factory: () => object): void };
	}
).jest;
moduleJest.unstable_mockModule(
	'../../contract-provenance/BoundedProvenanceJson.js',
	() => ({
		fetchProvenanceJson: rpcRequest
	})
);
const { sorobanDomainRouter } = await import('../SorobanDomainRouter.js');
const { SorobanDomainResolver } = await import('../SorobanDomainResolver.js');

const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const contract = StrKey.encodeContract(Buffer.alloc(32, 8));
const rpcUrl = new URL('http://127.0.0.1:8000');
const root = exactDomainName('mate.xlm')!;
const nested = exactDomainName('treasury.addresses.mate.xlm')!;
const now = 1_793_800_000;
const ledger = 55_321_000;
const bytes = (value: string | Uint8Array) =>
	xdr.ScVal.scvBytes(Buffer.from(value));
const u64 = (value: number) =>
	xdr.ScVal.scvU64(xdr.Uint64.fromString(String(value)));
const address = (value: string) => new Address(value).toScVal();

function record(fields: Record<string, xdr.ScVal>) {
	return xdr.ScVal.scvMap(
		Object.keys(fields)
			.sort()
			.map(
				(key) =>
					new xdr.ScMapEntry({
						key: xdr.ScVal.scvSymbol(key),
						val: fields[key]!
					})
			)
	);
}

function tuple({
	expiresAt = now + 300,
	rootFields = {},
	subFields
}: {
	expiresAt?: number;
	rootFields?: Record<string, xdr.ScVal>;
	subFields?: Record<string, xdr.ScVal>;
} = {}) {
	return xdr.ScVal.scvVec([
		record({
			address: address(account),
			domain: bytes('mate'),
			exp_date: u64(expiresAt),
			node: bytes(root.nodes[0]!),
			snapshot: u64(now - 300),
			tld: bytes('xlm'),
			token_id: xdr.ScVal.scvU32(21),
			...rootFields
		}),
		subFields
			? record({
					address: address(contract),
					domain: bytes('treasury'),
					node: bytes(nested.nodes[2]!),
					parent: bytes(nested.nodes[1]!),
					root: bytes(root.nodes[0]!),
					snapshot: u64(now - 300),
					...subFields
				})
			: xdr.ScVal.scvVoid()
	]);
}

function installRpc({
	passphrase = Networks.PUBLIC,
	simulation = {
		latestLedger: ledger,
		results: [{ xdr: tuple().toXDR('base64') }]
	},
	closeTime = now - 2,
	sequence = ledger
}: {
	passphrase?: string;
	simulation?: object;
	closeTime?: number;
	sequence?: number;
} = {}) {
	rpcRequest.mockImplementation(async (_url, { method }) => ({
		jsonrpc: '2.0',
		id: 1,
		result:
			method === 'getNetwork'
				? { passphrase }
				: method === 'simulateTransaction'
					? simulation
					: { ledgers: [{ sequence, ledgerCloseTime: String(closeTime) }] }
	}));
}

function app(networkPassphrase: string = Networks.PUBLIC) {
	return express().use(
		'/v1',
		sorobanDomainRouter({
			networkPassphrase,
			rpcUrl: rpcUrl.href
		})
	);
}

beforeEach(() => {
	rpcRequest.mockReset();
	jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
	installRpc();
});

afterEach(() => jest.restoreAllMocks());

test('normalizes ASCII and encodes the root and nested exact registry keys', () => {
	expect(exactDomainName('TrEaSuRy.Addresses.MATE.XLM')).toEqual(nested);
	expect(Buffer.from(root.nodes[0]!).toString('hex')).toBe(
		'dc47a42304d00afd4fc1bc2ee84d78d55216a2366c9bf81e715d3541f4b790ab'
	);
	expect(registryRecordKey(nested).toXDR('base64')).toBe(
		xdr.ScVal.scvVec([
			xdr.ScVal.scvSymbol('SubDomain'),
			bytes(
				Buffer.from(
					'16b28a530aa8d77412f8cadb1d16600fc1c608d9ebb06eeec6456c3a4ad39679',
					'hex'
				)
			)
		]).toXDR('base64')
	);
});

test.each([
	'xlm',
	'mate..xlm',
	'mate2.xlm',
	'máte.xlm',
	'mate.com',
	'mate.xlm.',
	'mate.xlm\n',
	'abcdefghijklmnop.xlm',
	'a.b.c.d.e.xlm',
	'https://mate.xlm'
])('rejects unsupported input %j', (input) => {
	expect(exactDomainName(input)).toBeNull();
});

test('keeps the root account and nested contract destinations distinct from ownership', () => {
	expect(decodeRegistryRecord(root, tuple())).toMatchObject({
		kind: 'domain',
		addressKind: 'account',
		address: account,
		expiresAt: now + 300
	});
	expect(decodeRegistryRecord(nested, tuple({ subFields: {} }))).toMatchObject({
		kind: 'subdomain',
		addressKind: 'contract',
		address: contract,
		expiresAt: now + 300
	});
});

test.each<[string, xdr.ScVal]>([
	['parent', bytes(Buffer.alloc(32))],
	['root', bytes(Buffer.alloc(32))],
	['node', bytes(Buffer.alloc(32))],
	['domain', bytes('other')],
	['snapshot', u64(now)],
	['address', xdr.ScVal.scvString(account)]
])('refuses a mismatched nested %s', (key, value) => {
	expect(() =>
		decodeRegistryRecord(nested, tuple({ subFields: { [key]: value } }))
	).toThrow();
});

test('serves an exact lookup through the public route and caches the canonical name', async () => {
	const api = app();
	const response = await request(api)
		.get('/v1/soroban-domains/MATE.XLM')
		.expect(200);
	expect(response.headers['cache-control']).toBe('no-store');
	expect(response.body).toMatchObject({
		status: 'resolved',
		name: 'mate.xlm',
		source: 'creit-soroban-domains-v2',
		network: 'mainnet',
		registry: REGISTRY_V2,
		observedLedger: ledger,
		ledgerCloseTime: now - 2,
		record: { address: account }
	});
	const rpcPayload = rpcRequest.mock.calls[1]![1];
	expect(rpcPayload.method).toBe('simulateTransaction');
	const envelope = xdr.TransactionEnvelope.fromXDR(
		(rpcPayload.params as { transaction: string }).transaction,
		'base64'
	);
	if (envelope.type !== 'envelopeTypeTx')
		throw new Error('Expected a v1 transaction');
	expect(envelope.v1.signatures).toEqual([]);
	const body = envelope.v1.tx.operations[0]!.body;
	if (body.type !== 'invokeHostFunction')
		throw new Error('Expected one host invocation');
	const hostFunction = body.invokeHostFunctionOp.hostFunction;
	if (hostFunction.type !== 'hostFunctionTypeInvokeContract')
		throw new Error('Expected a contract call');
	const invocation = hostFunction.invokeContract;
	expect(Address.fromScAddress(invocation.contractAddress).toString()).toBe(
		REGISTRY_V2
	);
	expect(invocation.functionName.toString()).toBe('record');
	expect(invocation.args[0]?.toXDR('base64')).toBe(
		registryRecordKey(root).toXDR('base64')
	);
	await request(api).get('/v1/soroban-domains/mate.xlm').expect(200);
	expect(rpcRequest.mock.calls.map(([, payload]) => payload.method)).toEqual([
		'getNetwork',
		'simulateTransaction',
		'getLedgers'
	]);
});

test('blocks malformed names, testnet and unexpected RPC networks', async () => {
	await request(app()).get('/v1/soroban-domains/mate.com').expect(400);
	await request(app(Networks.TESTNET))
		.get('/v1/soroban-domains/mate.xlm')
		.expect(404);
	expect(rpcRequest).not.toHaveBeenCalled();
	installRpc({ passphrase: Networks.TESTNET });
	await request(app()).get('/v1/soroban-domains/mate.xlm').expect(503);
	expect(rpcRequest).toHaveBeenCalledTimes(1);
});

test.each([
	[307, 'not_found'],
	[308, 'expired']
])('classifies recognized registry error %s as %s', async (code, status) => {
	installRpc({
		simulation: {
			latestLedger: ledger,
			error: `host invocation failed\n\nCaused by:\n    HostError: Error(Contract, #${code})\n`
		}
	});
	const resolver = new SorobanDomainResolver(rpcUrl);
	await expect(resolver.resolve(root)).resolves.toMatchObject({ status });
	await expect(resolver.resolve(root)).resolves.toMatchObject({ status });
	expect(rpcRequest).toHaveBeenCalledTimes(3);
});

test('fails closed for unknown, archived, malformed or stale evidence and retries failures', async () => {
	const resolver = new SorobanDomainResolver(rpcUrl);
	installRpc({
		simulation: { latestLedger: ledger, error: 'Timeout at ledger 307' }
	});
	await expect(resolver.resolve(root)).rejects.toThrow();
	installRpc({ simulation: { latestLedger: ledger, restorePreamble: {} } });
	await expect(resolver.resolve(root)).rejects.toThrow();
	installRpc({
		simulation: { latestLedger: ledger, results: [{ xdr: 'AA==' }] }
	});
	await expect(resolver.resolve(root)).rejects.toThrow();
	installRpc({ sequence: ledger - 1 });
	await expect(resolver.resolve(root)).rejects.toThrow();
	installRpc({ closeTime: now - 61 });
	await expect(resolver.resolve(root)).rejects.toThrow();
	installRpc();
	await expect(resolver.resolve(root)).resolves.toMatchObject({
		status: 'resolved'
	});
});

test('stops returning a cached address when the root expires', async () => {
	installRpc({
		simulation: {
			latestLedger: ledger,
			results: [{ xdr: tuple({ expiresAt: now + 1 }).toXDR('base64') }]
		}
	});
	const resolver = new SorobanDomainResolver(rpcUrl);
	await expect(resolver.resolve(root)).resolves.toMatchObject({
		status: 'resolved'
	});
	jest.mocked(Date.now).mockReturnValue((now + 1) * 1000);
	await expect(resolver.resolve(root)).resolves.toMatchObject({
		status: 'expired'
	});
	expect(rpcRequest).toHaveBeenCalledTimes(6);
});

test('coalesces duplicate requests and rejects excess concurrent lookups', async () => {
	const resolver = new SorobanDomainResolver(rpcUrl);
	const first = resolver.resolve(root);
	const second = resolver.resolve(root);
	const other = resolver.resolve(exactDomainName('other.xlm')!);
	await expect(resolver.resolve(nested)).rejects.toThrow();
	const outcomes = await Promise.allSettled([first, second, other]);
	expect(outcomes.map(({ status }) => status)).toEqual([
		'fulfilled',
		'fulfilled',
		'rejected'
	]);
	expect(
		rpcRequest.mock.calls.filter(
			([, payload]) => payload.method === 'getNetwork'
		)
	).toHaveLength(2);
});
