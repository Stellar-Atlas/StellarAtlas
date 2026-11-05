import { Address, Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { fetchProvenanceJson } from '../BoundedProvenanceJson.js';
import { ContractProvenanceService } from '../ContractProvenanceService.js';
import { ContractRpcUnavailable } from '../ContractRpcCode.js';
import { scopedProvenanceRpc } from '../ScopedProvenanceRpc.js';

const { jest: mocks } = import.meta as ImportMeta & { jest: typeof jest };
const url = 'https://rpc.example.invalid/stellar';
const now = 1_800_000_000_000;
const latestLedger = 150;
const contractId = StrKey.encodeContract(new Uint8Array(32).fill(7));
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const hash = createHash('sha256').update(wasm).digest('hex');

function instanceXdr(
	id = contractId,
	durability = xdr.ContractDataDurability.persistent
) {
	return xdr.LedgerEntryData.contractData(
		new xdr.ContractDataEntry({
			ext: xdr.ExtensionPoint.v0(),
			contract: new Address(id).toScAddress(),
			key: xdr.ScVal.scvLedgerKeyContractInstance(),
			durability,
			val: xdr.ScVal.scvContractInstance(
				new xdr.ScContractInstance({
					executable: xdr.ContractExecutable.contractExecutableWasm(hash),
					storage: null
				})
			)
		})
	).toXDR('base64');
}

function codeXdr(code = wasm, declaredHash = hash) {
	return xdr.LedgerEntryData.contractCode(
		new xdr.ContractCodeEntry({
			ext: xdr.ContractCodeEntryExt.v0(),
			hash: declaredHash,
			code
		})
	).toXDR('base64');
}

function fixture(
	overrides: {
		network?: object;
		health?: object;
		instance?: object;
		code?: object;
		instanceResult?: object;
		codeResult?: object;
		envelope?: object;
	} = {}
) {
	return mocks.fn<
		ReturnType<typeof fetchProvenanceJson>,
		Parameters<typeof fetchProvenanceJson>
	>(async (_, body) => {
		const { id, method, params } = body as {
			id: number;
			method: string;
			params?: { keys: string[] };
		};
		let result: object;
		if (method === 'getNetwork')
			result = {
				passphrase: Networks.PUBLIC,
				protocolVersion: 29,
				...overrides.network
			};
		else if (method === 'getHealth')
			result = {
				status: 'healthy',
				latestLedger,
				latestLedgerCloseTime: String(now / 1_000 - 2),
				...overrides.health
			};
		else {
			if (method !== 'getLedgerEntries' || !params || params.keys.length !== 1)
				throw new Error('Unexpected fixture request');
			const instance = id === 3;
			result = {
				latestLedger,
				entries: [
					{
						key: params.keys[0],
						xdr: instance ? instanceXdr() : codeXdr(),
						lastModifiedLedgerSeq: 100,
						liveUntilLedgerSeq: 500,
						...(instance ? overrides.instance : overrides.code)
					}
				],
				...(instance ? overrides.instanceResult : overrides.codeResult)
			};
		}
		return { jsonrpc: '2.0', id, result, ...overrides.envelope };
	});
}

let monotonicTime = performance.now();
beforeEach(() => {
	monotonicTime += 20_000;
	mocks.spyOn(Date, 'now').mockReturnValue(now);
	mocks.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
});
afterEach(() => mocks.restoreAllMocks());

it('reads only the expected keys from the same fixed HTTPS endpoint within one budget', async () => {
	const request = fixture({ codeResult: { latestLedger: latestLedger + 1 } });
	const reader = scopedProvenanceRpc(url, Networks.PUBLIC, request);
	const observation = await reader.read(contractId);
	expect(observation).toMatchObject({ ledger: latestLedger, wasmSha256: hash });
	const [network, health, instance, code] = request.mock.calls;
	expect(request).toHaveBeenCalledTimes(4);
	expect(request.mock.calls.map(([endpoint]) => endpoint.href)).toEqual(
		Array(4).fill(url)
	);
	expect(network![1]).toEqual({ jsonrpc: '2.0', id: 1, method: 'getNetwork' });
	expect(health![1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'getHealth' });
	const keys = [instance, code].map(
		(call) => (call![1] as { params: { keys: string[] } }).params.keys[0]!
	);
	expect(
		xdr.LedgerKey.fromXDR(keys[0]!, 'base64').contractData.contract.toXDR(
			'base64'
		)
	).toBe(new Address(contractId).toScAddress().toXDR('base64'));
	expect(
		xdr.LedgerKey.fromXDR(keys[1]!, 'base64').contractCode.hash.toString()
	).toBe(hash);
	expect(request.mock.calls.map((call) => call[2]?.maxResponseBytes)).toEqual([
		16 * 1024,
		16 * 1024,
		3 * 1024 * 1024,
		3 * 1024 * 1024
	]);
	for (const [, , limits] of request.mock.calls)
		expect(limits?.timeoutMs).toBeLessThanOrEqual(8_000);
	expect(code![2]!.timeoutMs).toBeLessThanOrEqual(network![2]!.timeoutMs!);
});

it.each([
	['wrong network', { network: { passphrase: Networks.TESTNET } }, 1],
	['wrong JSON-RPC id', { envelope: { id: 999 } }, 1],
	['RPC error envelope', { envelope: { error: { code: -32000 } } }, 1],
	['unhealthy node', { health: { status: 'catching_up' } }, 2],
	[
		'stale close time',
		{ health: { latestLedgerCloseTime: String(now / 1_000 - 30) } },
		2
	],
	[
		'future close time',
		{ health: { latestLedgerCloseTime: String(now / 1_000 + 6) } },
		2
	],
	[
		'malformed close time',
		{ health: { latestLedgerCloseTime: now / 1_000 } },
		2
	],
	[
		'stale entry snapshot',
		{ instanceResult: { latestLedger: latestLedger - 1 } },
		3
	],
	[
		'future entry snapshot',
		{ instanceResult: { latestLedger: latestLedger + 9 } },
		3
	],
	['malformed entry set', { instanceResult: { entries: null } }, 3],
	['wrong response key', { instance: { key: 'AAAA' } }, 3],
	['malformed XDR', { instance: { xdr: '////' } }, 3],
	[
		'wrong contract XDR',
		{
			instance: { xdr: instanceXdr(StrKey.encodeContract(new Uint8Array(32))) }
		},
		3
	],
	[
		'nonpersistent instance XDR',
		{
			instance: {
				xdr: instanceXdr(contractId, xdr.ContractDataDurability.temporary)
			}
		},
		3
	],
	['archived instance', { instance: { liveUntilLedgerSeq: 0 } }, 3],
	['missing TTL', { instance: { liveUntilLedgerSeq: undefined } }, 3],
	['missing code', { codeResult: { entries: [] } }, 4],
	[
		'wrong embedded code hash',
		{ code: { xdr: codeXdr(wasm, '01'.repeat(32)) } },
		4
	],
	[
		'right embedded hash with wrong bytes',
		{ code: { xdr: codeXdr(Buffer.from('wrong')) } },
		4
	],
	[
		'code modified after instance snapshot',
		{
			codeResult: { latestLedger: latestLedger + 1 },
			code: { lastModifiedLedgerSeq: latestLedger + 1 }
		},
		4
	]
] as const)(
	'rejects %s without extra attempts',
	async (_, overrides, calls) => {
		const request = fixture(overrides);
		await expect(
			scopedProvenanceRpc(url, Networks.PUBLIC, request).read(contractId)
		).rejects.toBeInstanceOf(ContractRpcUnavailable);
		expect(request).toHaveBeenCalledTimes(calls);
	}
);

it.each([
	'',
	'http://rpc.example.invalid',
	'https:///rpc.example.invalid',
	'https://user@rpc.example.invalid',
	'https://rpc.example.invalid/?token=foo',
	'https://rpc.example.invalid/#',
	' https://rpc.example.invalid'
])('fails closed for invalid endpoint %s', async (endpoint) => {
	const request = fixture();
	await expect(
		scopedProvenanceRpc(endpoint, Networks.PUBLIC, request).read(contractId)
	).rejects.toBeInstanceOf(ContractRpcUnavailable);
	expect(request).not.toHaveBeenCalled();
});

it('refuses a non-mainnet Atlas configuration before calling any upstream', async () => {
	const request = fixture();
	await expect(
		scopedProvenanceRpc(url, Networks.TESTNET, request).read(contractId)
	).rejects.toBeInstanceOf(ContractRpcUnavailable);
	expect(request).not.toHaveBeenCalled();
});

it('does not publish a cached observation after the health close-time expiry', async () => {
	const request = fixture();
	const reader = scopedProvenanceRpc(url, Networks.PUBLIC, request);
	const service = new ContractProvenanceService(
		undefined,
		Networks.PUBLIC,
		reader
	);
	expect(await service.get(contractId)).toMatchObject({
		ledgerEvidence: 'configured_rpc_observation',
		build: { status: 'metadata_missing' },
		securityAudit: 'not_assessed'
	});
	await expect(service.get(contractId)).resolves.toMatchObject({
		wasmSha256: hash
	});
	expect(request).toHaveBeenCalledTimes(4);
	mocks.mocked(Date.now).mockReturnValue(now + 27_999);
	await service.get(contractId);
	expect(request).toHaveBeenCalledTimes(4);
	mocks.mocked(Date.now).mockReturnValue(now + 28_000);
	monotonicTime += 28_000;
	await expect(service.get(contractId)).rejects.toBeInstanceOf(
		ContractRpcUnavailable
	);
	expect(request).toHaveBeenCalledTimes(6);
});

it('shares a fail-fast, no-queue admission cap across adapter instances', async () => {
	const request = fixture();
	let release!: (value: unknown) => void;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	request.mockImplementationOnce(() => held).mockImplementationOnce(() => held);
	const first = scopedProvenanceRpc(url, Networks.PUBLIC, request).read(
		contractId
	);
	const second = scopedProvenanceRpc(url, Networks.PUBLIC, request).read(
		contractId
	);
	try {
		await expect(
			scopedProvenanceRpc(url, Networks.PUBLIC, request).read(contractId)
		).rejects.toBeInstanceOf(ContractRpcUnavailable);
		expect(request).toHaveBeenCalledTimes(2);
	} finally {
		release({});
		await Promise.allSettled([first, second]);
	}
	monotonicTime += 10_000;
	await expect(
		scopedProvenanceRpc(url, Networks.PUBLIC, request).read(contractId)
	).resolves.toMatchObject({ wasmSha256: hash });
});

it('does not reset the overall deadline after an individual RPC call', async () => {
	const request = fixture();
	request.mockImplementationOnce(async () => {
		monotonicTime += 8_000;
		return {
			jsonrpc: '2.0',
			id: 1,
			result: { passphrase: Networks.PUBLIC, protocolVersion: 29 }
		};
	});
	await expect(
		scopedProvenanceRpc(url, Networks.PUBLIC, request).read(contractId)
	).rejects.toBeInstanceOf(ContractRpcUnavailable);
	expect(request).toHaveBeenCalledTimes(1);
});

it('holds a replacement process for the prior process window before sending any call', async () => {
	await mocks.isolateModulesAsync(async () => {
		const { scopedProvenanceRpc: freshReader } =
			await import('../ScopedProvenanceRpc.js');
		const request = fixture();
		const reader = freshReader(url, Networks.PUBLIC, request);
		monotonicTime += 9_999;
		await expect(reader.read(contractId)).rejects.toThrow(
			'RPC evidence is unavailable'
		);
		expect(request).not.toHaveBeenCalled();
		monotonicTime++;
		await expect(reader.read(contractId)).resolves.toMatchObject({
			wasmSha256: hash
		});
		expect(request).toHaveBeenCalledTimes(4);
	});
});

it('shares a rolling monotonic attempt budget across readers and counts provider errors', async () => {
	const request = fixture({ envelope: { error: { code: -32000 } } });
	const readers = [
		scopedProvenanceRpc(url, Networks.PUBLIC, request),
		scopedProvenanceRpc(
			'https://other.example.invalid/stellar',
			Networks.PUBLIC,
			request
		)
	];
	const start = monotonicTime;
	for (let i = 0; i < 4; i++) {
		monotonicTime = start + i * 1_000;
		await expect(
			readers[i % 2]!.read(StrKey.encodeContract(new Uint8Array(32).fill(i)))
		).rejects.toBeInstanceOf(ContractRpcUnavailable);
	}
	expect(request).toHaveBeenCalledTimes(4);
	monotonicTime = start + 9_999;
	mocks.mocked(Date.now).mockReturnValue(now + 86_400_000);
	await expect(readers[0]!.read(contractId)).rejects.toBeInstanceOf(
		ContractRpcUnavailable
	);
	expect(request).toHaveBeenCalledTimes(4);
	monotonicTime++;
	mocks.mocked(Date.now).mockReturnValue(now - 86_400_000);
	await expect(readers[1]!.read(contractId)).rejects.toBeInstanceOf(
		ContractRpcUnavailable
	);
	expect(request).toHaveBeenCalledTimes(5);
	await expect(readers[0]!.read(contractId)).rejects.toBeInstanceOf(
		ContractRpcUnavailable
	);
	expect(request).toHaveBeenCalledTimes(5);
	monotonicTime += 1_000;
	await expect(readers[0]!.read(contractId)).rejects.toBeInstanceOf(
		ContractRpcUnavailable
	);
	expect(request).toHaveBeenCalledTimes(6);
});
