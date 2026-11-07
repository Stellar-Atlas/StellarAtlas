import { createHash } from 'node:crypto';
import {
	Address,
	Asset,
	Networks,
	StrKey,
	nativeToScVal,
	xdr
} from '@stellar/stellar-sdk';
import { produceTimelockEvidence } from '../TimelockEvidenceProducer.js';
import { projectTimelockPositions } from '../TimelockPositions.js';

const networkPassphrase = Networks.TESTNET;
const ledger = 200;
const contractId = StrKey.encodeContract(Buffer.alloc(32, 4));
const secondContract = StrKey.encodeContract(Buffer.alloc(32, 5));
const beneficiary = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
const wasm = Buffer.from('0061736d01000000', 'hex');
const wasmSha256 = digest(wasm);
const wasmHash = Buffer.from(wasmSha256, 'hex');
const networkId = digest(networkPassphrase);
const registration = { networkId, contractId, wasmSha256, assetId: 'native' };

function digest(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('hex');
}

function headerFixture(sequence: number, baseFee = 100, claimedHash?: string) {
	const zeroHash = Buffer.alloc(32);
	const header = new xdr.LedgerHeader({
		ledgerVersion: 23,
		previousLedgerHash: zeroHash,
		scpValue: new xdr.StellarValue({
			txSetHash: zeroHash,
			closeTime: 1_700_000_000n,
			upgrades: [],
			ext: xdr.StellarValueExt.stellarValueBasic()
		}),
		txSetResultHash: zeroHash,
		bucketListHash: zeroHash,
		ledgerSeq: sequence,
		totalCoins: 0n,
		feePool: 0n,
		inflationSeq: 0,
		idPool: 0n,
		baseFee,
		baseReserve: 5_000_000,
		maxTxSetSize: 1000,
		skipList: [zeroHash, zeroHash, zeroHash, zeroHash],
		ext: xdr.LedgerHeaderExt.v0()
	});
	const hash = claimedHash ?? digest(header.toXDR());
	return {
		sequence,
		hash,
		headerXdr: new xdr.LedgerHeaderHistoryEntry({
			header,
			hash: Buffer.from(hash, 'hex'),
			ext: xdr.LedgerHeaderHistoryEntryExt.v0()
		}).toXDR('base64')
	};
}

const header = headerFixture(ledger);
const snapshot = { networkId, ledger, ledgerHash: header.hash };
const input = {
	rpcUrl: 'https://rpc.example.test/v1',
	networkPassphrase,
	snapshot,
	registry: [registration]
};

const sym = (name: string) => nativeToScVal(name, { type: 'symbol' });
const tag = (name: string) => xdr.ScVal.scvVec([sym(name)]);
const field = (name: string, val: xdr.ScVal) =>
	new xdr.ScMapEntry({ key: sym(name), val });
const storage = [
	new xdr.ScMapEntry({
		key: tag('Balance'),
		val: xdr.ScVal.scvMap([
			field('amount', nativeToScVal(123456789n, { type: 'i128' })),
			field(
				'claimants',
				xdr.ScVal.scvVec([new Address(beneficiary).toScVal()])
			),
			field(
				'time_bound',
				xdr.ScVal.scvMap([
					field('kind', tag('After')),
					field('timestamp', nativeToScVal(1700000000n, { type: 'u64' }))
				])
			),
			field(
				'token',
				new Address(Asset.native().contractId(networkPassphrase)).toScVal()
			)
		])
	}),
	new xdr.ScMapEntry({ key: tag('Init'), val: xdr.ScVal.scvVoid() })
];

function instanceRow(
	id = contractId,
	executable = xdr.ContractExecutable.contractExecutableWasm(wasmHash)
) {
	const identity = {
		contract: new Address(id).toScAddress(),
		key: xdr.ScVal.scvLedgerKeyContractInstance(),
		durability: xdr.ContractDataDurability.persistent
	};
	return {
		key: xdr.LedgerKey.contractData(
			new xdr.LedgerKeyContractData(identity)
		).toXDR('base64'),
		xdr: xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				...identity,
				ext: xdr.ExtensionPoint.v0(),
				val: xdr.ScVal.scvContractInstance(
					new xdr.ScContractInstance({ executable, storage })
				)
			})
		).toXDR('base64'),
		lastModifiedLedgerSeq: 198,
		liveUntilLedgerSeq: ledger
	};
}

function codeRow(code = wasm, hash = wasmHash) {
	return {
		key: xdr.LedgerKey.contractCode(
			new xdr.LedgerKeyContractCode({ hash })
		).toXDR('base64'),
		xdr: xdr.LedgerEntryData.contractCode(
			new xdr.ContractCodeEntry({
				ext: xdr.ContractCodeEntryExt.v0(),
				hash,
				code
			})
		).toXDR('base64'),
		lastModifiedLedgerSeq: 150,
		liveUntilLedgerSeq: 210
	};
}

const instance = instanceRow();
const code = codeRow();

function provider(
	overrides: {
		readonly entries?: readonly unknown[];
		readonly entryLedger?: number;
		readonly history?: readonly unknown[];
		readonly passphrase?: string;
	} = {}
) {
	const results = {
		getNetwork: { passphrase: overrides.passphrase ?? networkPassphrase },
		getLedgerEntries: {
			latestLedger: overrides.entryLedger ?? ledger,
			entries: overrides.entries ?? [instance, code]
		},
		// The history endpoint may advance after the state batch.
		getLedgers: {
			latestLedger: ledger + 1,
			ledgers: overrides.history ?? [header]
		}
	};
	type Method = keyof typeof results;
	const calls: { method: Method; params?: unknown }[] = [];
	const fetchJson: Parameters<typeof produceTimelockEvidence>[1] = async (
		url,
		body,
		options
	) => {
		expect(url.href).toBe(input.rpcUrl);
		expect(options?.signal?.aborted).toBe(false);
		const request = body as { method: Method; id: Method; params?: unknown };
		calls.push({ method: request.method, params: request.params });
		return { jsonrpc: '2.0', id: request.id, result: results[request.method] };
	};
	return { calls, fetchJson };
}

test('binds the batch to exact keys, XDR digests, TTLs and the selected snapshot for the adapter', async () => {
	const { calls, fetchJson } = provider();
	const result = await produceTimelockEvidence(input, fetchJson);
	expect(calls).toEqual([
		{ method: 'getNetwork' },
		{ method: 'getLedgerEntries', params: { keys: [instance.key, code.key] } },
		{
			method: 'getLedgers',
			params: { startLedger: ledger, pagination: { limit: 1 } }
		}
	]);
	const source = result.source!;
	expect(source.trust).toBe('provider_correlated');
	expect(source.sha256).toBe(digest(source.json));
	expect(JSON.parse(source.json)).toMatchObject({
		providerOrigin: 'https://rpc.example.test',
		providerUrlSha256: digest(input.rpcUrl),
		networkPassphrase,
		...snapshot,
		headerXdr: header.headerXdr,
		requestedKeys: [instance.key, code.key],
		entries: [instance, code].map((row) => ({
			...row,
			xdrSha256: digest(Buffer.from(row.xdr, 'base64'))
		}))
	});
	expect(result.evidenceByContract.get(contractId)).toEqual({
		...snapshot,
		contractId,
		state: 'live',
		modifiedLedger: instance.lastModifiedLedgerSeq,
		liveUntilLedger: instance.liveUntilLedgerSeq,
		instanceXdr: instance.xdr,
		rawEvidenceSha256: source.sha256
	});
	expect(
		projectTimelockPositions({
			...input,
			accountId: beneficiary,
			evidenceByContract: result.evidenceByContract
		}).positions
	).toMatchObject([
		{
			status: 'observed',
			amountRaw: '123456789',
			beneficiary,
			withdrawal: 'unknown',
			rawEvidenceSha256: source.sha256
		}
	]);
});

test('reorders rows by requested key and asks only once for shared Wasm', async () => {
	const second = instanceRow(secondContract);
	const scoped = {
		...input,
		registry: [registration, { ...registration, contractId: secondContract }]
	};
	const ordered = await produceTimelockEvidence(
		scoped,
		provider({ entries: [instance, code, second] }).fetchJson
	);
	const { fetchJson, calls } = provider({ entries: [second, code, instance] });
	const reordered = await produceTimelockEvidence(scoped, fetchJson);
	expect(reordered).toEqual(ordered);
	expect([...reordered.evidenceByContract.keys()]).toEqual([
		contractId,
		secondContract
	]);
	expect(calls[1]?.params).toEqual({
		keys: [instance.key, code.key, second.key]
	});
});

test.each([
	['missing instance', [code]],
	['missing code', [instance]],
	['both missing', []],
	[
		'unknown instance TTL',
		[{ ...instance, liveUntilLedgerSeq: undefined }, code]
	],
	['zero instance TTL', [{ ...instance, liveUntilLedgerSeq: 0 }, code]],
	['expired code TTL', [instance, { ...code, liveUntilLedgerSeq: ledger - 1 }]]
])('leaves %s unobserved', async (_label, entries) => {
	const result = await produceTimelockEvidence(
		input,
		provider({ entries }).fetchJson
	);
	expect(result.evidenceByContract.size).toBe(0);
	expect(result.source?.trust).toBe('provider_correlated');
	expect(
		projectTimelockPositions({
			...input,
			accountId: beneficiary,
			evidenceByContract: result.evidenceByContract
		}).positions
	).toMatchObject([{ status: 'unobserved', rawEvidenceSha256: null }]);
});

test.each([ledger - 1, ledger + 1])(
	'rejects an entry batch at ledger %i',
	async (entryLedger) => {
		const { fetchJson, calls } = provider({ entryLedger });
		await expect(produceTimelockEvidence(input, fetchJson)).rejects.toThrow(
			'batch ledger mismatch'
		);
		expect(calls.map(({ method }) => method)).toEqual([
			'getNetwork',
			'getLedgerEntries'
		]);
	}
);

test.each([
	['duplicate key', [instance, instance], 'duplicate timelock entry key'],
	[
		'unrequested row',
		[instanceRow(secondContract), code],
		'Unrequested timelock entry key'
	],
	[
		'wrong instance identity',
		[{ ...instanceRow(secondContract), key: instance.key }, code],
		'instance key mismatch'
	],
	[
		'wrong code key',
		[instance, { ...codeRow(wasm, Buffer.alloc(32, 9)), key: code.key }],
		'Wasm digest or code key mismatch'
	],
	[
		'wrong Wasm content digest',
		[instance, codeRow(Buffer.from('wrong Wasm'))],
		'Wasm digest or code key mismatch'
	],
	[
		'noncanonical XDR',
		[{ ...instance, xdr: instance.xdr + '\n' }, code],
		'entry XDR'
	],
	[
		'future modification',
		[{ ...instance, lastModifiedLedgerSeq: ledger + 1 }, code],
		'ledger bounds'
	],
	[
		'impossible TTL',
		[{ ...instance, liveUntilLedgerSeq: 100 }, code],
		'ledger bounds'
	]
])('rejects %s', async (_label, entries, message) => {
	await expect(
		produceTimelockEvidence(input, provider({ entries }).fetchJson)
	).rejects.toThrow(message);
});

test.each([
	[
		'different sequence',
		[{ ...header, sequence: ledger - 1 }],
		'header snapshot mismatch'
	],
	[
		'different fork',
		[{ ...header, hash: 'f'.repeat(64) }],
		'header snapshot mismatch'
	],
	[
		'substituted header XDR',
		[{ ...header, headerXdr: headerFixture(ledger + 1).headerXdr }],
		'header digest or sequence mismatch'
	],
	[
		'forged header contents under the correct sequence and claimed hash',
		[headerFixture(ledger, 101, header.hash)],
		'header digest or sequence mismatch'
	],
	['duplicate headers', [header, header], 'ledger history']
])('rejects %s', async (_label, history, message) => {
	await expect(
		produceTimelockEvidence(input, provider({ history }).fetchJson)
	).rejects.toThrow(message);
});

test('rejects a different provider network before fetching entries', async () => {
	const { fetchJson, calls } = provider({ passphrase: Networks.PUBLIC });
	await expect(produceTimelockEvidence(input, fetchJson)).rejects.toThrow(
		'network mismatch'
	);
	expect(calls.map(({ method }) => method)).toEqual(['getNetwork']);
});

test.each([
	['invalid contract', [{ ...registration, contractId: beneficiary }]],
	['invalid digest', [{ ...registration, wasmSha256: 'x'.repeat(64) }]],
	['unsupported asset', [{ ...registration, assetId: 'unsupported' }]],
	['duplicate contract', [registration, registration]],
	['oversized registry', Array.from({ length: 17 }, () => registration)]
])('rejects %s before provider access', async (_label, registry) => {
	const { fetchJson, calls } = provider();
	await expect(
		produceTimelockEvidence({ ...input, registry }, fetchJson)
	).rejects.toThrow(/registration|registry/);
	expect(calls).toEqual([]);
});

test.each([[], [{ ...registration, networkId: 'f'.repeat(64) }]])(
	'skips provider access when no registrations apply %#',
	async (...registrations) => {
		const { fetchJson, calls } = provider();
		const result = await produceTimelockEvidence(
			{ ...input, registry: registrations },
			fetchJson
		);
		expect(result.source).toBeNull();
		expect(result.evidenceByContract.size).toBe(0);
		expect(calls).toEqual([]);
	}
);

test.each([
	xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 8)),
	xdr.ContractExecutable.contractExecutableStellarAsset()
])(
	'flags an unsupported executable without looking up its code %#',
	async (executable) => {
		const { fetchJson, calls } = provider({
			entries: [instanceRow(contractId, executable)]
		});
		const result = await produceTimelockEvidence(input, fetchJson);
		expect(calls[1]?.params).toEqual({ keys: [instance.key, code.key] });
		expect(result.unsupportedExecutableContractIds).toEqual([contractId]);
		expect(result.evidenceByContract.size).toBe(0);
	}
);

test('changes the batch digest when a provider TTL changes', async () => {
	const before = await produceTimelockEvidence(input, provider().fetchJson);
	const after = await produceTimelockEvidence(
		input,
		provider({
			entries: [{ ...instance, liveUntilLedgerSeq: ledger + 1 }, code]
		}).fetchJson
	);
	expect(after.source?.sha256).not.toBe(before.source?.sha256);
});
