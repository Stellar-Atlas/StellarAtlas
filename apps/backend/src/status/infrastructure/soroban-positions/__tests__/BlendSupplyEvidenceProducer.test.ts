import { createHash } from 'node:crypto';
import { Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import { ProvenanceHttpError } from '../../http/contract-provenance/BoundedProvenanceJson.js';
import {
	blendFixedSupplyKeys,
	blendFixedSupplyTarget,
	projectBlendFixedSupply
} from '../BlendFixedSupply.js';
import { produceBlendSupplyEvidence } from '../BlendSupplyEvidenceProducer.js';

const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const otherAccount = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const keys = blendFixedSupplyKeys(accountId);
const { wasmSha256, networkId } = blendFixedSupplyTarget;
const digest = (bytes: string | Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex');
const codeKey = xdr.LedgerKey.contractCode(
	new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmSha256, 'hex') })
).toXDR('base64');
const ledger = 200;
const zero = Buffer.alloc(32);
const rpcUrl = 'https://rpc.example.test/v1';

function headerFixture(baseFee = 100, claimedHash?: string) {
	const header = new xdr.LedgerHeader({
		ledgerVersion: 23,
		previousLedgerHash: zero,
		scpValue: new xdr.StellarValue({
			txSetHash: zero,
			closeTime: 1_700_000_000n,
			upgrades: [],
			ext: xdr.StellarValueExt.stellarValueBasic()
		}),
		txSetResultHash: zero,
		bucketListHash: zero,
		ledgerSeq: ledger,
		totalCoins: 0n,
		feePool: 0n,
		inflationSeq: 0,
		idPool: 0n,
		baseFee,
		baseReserve: 5_000_000,
		maxTxSetSize: 1000,
		skipList: [zero, zero, zero, zero],
		ext: xdr.LedgerHeaderExt.v0()
	});
	const hash = claimedHash ?? digest(header.toXDR());
	return {
		sequence: ledger,
		hash,
		headerXdr: new xdr.LedgerHeaderHistoryEntry({
			header,
			hash: Buffer.from(hash, 'hex'),
			ext: xdr.LedgerHeaderHistoryEntryExt.v0()
		}).toXDR('base64')
	};
}

const header = headerFixture();
const snapshot = { networkId, ledger, ledgerHash: header.hash };
const input = { rpcUrl, accountId, snapshot };

function contractRow(key: string, val = xdr.ScVal.scvVoid()) {
	const {
		contract,
		key: dataKey,
		durability
	} = xdr.LedgerKey.fromXDR(key, 'base64').contractData;
	return {
		key,
		xdr: xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				contract,
				key: dataKey,
				durability,
				val,
				ext: xdr.ExtensionPoint.v0()
			})
		).toXDR('base64'),
		lastModifiedLedgerSeq: 198,
		liveUntilLedgerSeq: ledger
	};
}

function instanceRow(
	executable = xdr.ContractExecutable.contractExecutableWasm(
		Buffer.from(wasmSha256, 'hex')
	)
) {
	return contractRow(
		keys.instance,
		xdr.ScVal.scvContractInstance(
			new xdr.ScContractInstance({ executable, storage: [] })
		)
	);
}

function invalidCodeRow(hash = Buffer.from(wasmSha256, 'hex')) {
	return {
		key: codeKey,
		xdr: xdr.LedgerEntryData.contractCode(
			new xdr.ContractCodeEntry({
				hash,
				code: Buffer.from('0061736d01000000', 'hex'),
				ext: xdr.ContractCodeEntryExt.v0()
			})
		).toXDR('base64'),
		lastModifiedLedgerSeq: 150,
		liveUntilLedgerSeq: ledger + 1
	};
}

const sharedRows = [
	instanceRow(),
	contractRow(keys.reserveList),
	contractRow(keys.reserveConfig),
	contractRow(keys.reserveData)
];
const accountRow = contractRow(keys.positions);
const rowsWithoutCode = [...sharedRows, accountRow];

function provider(
	options: {
		readonly rows?: readonly unknown[];
		readonly entryLedger?: number;
		readonly passphrase?: string;
		readonly header?: unknown;
		readonly throttle?: boolean;
	} = {}
) {
	const results = {
		getNetwork: { passphrase: options.passphrase ?? Networks.PUBLIC },
		getLedgerEntries: {
			latestLedger: options.entryLedger ?? ledger,
			entries: options.rows ?? rowsWithoutCode
		},
		getLedgers: {
			latestLedger: ledger + 1,
			ledgers: [options.header ?? header]
		}
	};
	type Method = keyof typeof results;
	const calls: { method: Method; params?: unknown }[] = [];
	const request: NonNullable<
		Parameters<typeof produceBlendSupplyEvidence>[1]
	> = async (url, body, config) => {
		expect(url.href).toBe(rpcUrl);
		expect(config?.signal?.aborted).toBe(false);
		expect(config?.maxResponseBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
		const call = body as { method: Method; id: string; params?: unknown };
		calls.push({ method: call.method, params: call.params });
		if (options.throttle && call.method === 'getLedgerEntries')
			throw new ProvenanceHttpError(429, 'http', 'rate limited');
		return { jsonrpc: '2.0', id: call.id, result: results[call.method] };
	};
	return { request, calls };
}

test('requests six exact keys in one batch and binds network, header and raw evidence', async () => {
	const { request, calls } = provider();
	const result = await produceBlendSupplyEvidence(input, request);
	expect(calls).toEqual([
		{ method: 'getNetwork' },
		{
			method: 'getLedgerEntries',
			params: {
				keys: [
					keys.instance,
					keys.reserveList,
					keys.reserveConfig,
					keys.reserveData,
					codeKey,
					keys.positions
				]
			}
		},
		{
			method: 'getLedgers',
			params: { startLedger: ledger, pagination: { limit: 1 } }
		}
	]);
	expect(result.trust).toBe('provider_correlated');
	const { shared, account, code } = result.documents;
	expect(shared.sha256).toBe(digest(shared.json));
	expect(account.sha256).toBe(digest(account.json));
	expect(code).toBeNull();
	expect(JSON.parse(shared.json)).toMatchObject({
		...snapshot,
		headerXdr: header.headerXdr,
		providerOrigin: 'https://rpc.example.test',
		providerUrlSha256: digest(rpcUrl),
		requestedKeys: [
			keys.instance,
			keys.reserveList,
			keys.reserveConfig,
			keys.reserveData,
			codeKey
		],
		codeRow: null
	});
	expect(JSON.parse(account.json)).toMatchObject({
		sharedSha256: shared.sha256,
		accountId,
		requestedKey: keys.positions,
		row: {
			xdr: accountRow.xdr,
			xdrSha256: digest(Buffer.from(accountRow.xdr, 'base64'))
		}
	});
	expect(shared.json).not.toContain(accountRow.xdr);
	expect(account.json).not.toContain(sharedRows[0]!.xdr);
	expect(result.adapterEvidence).toBeUndefined();
});

test('keeps shared evidence identical across accounts and provider row order', async () => {
	const first = await produceBlendSupplyEvidence(input, provider().request);
	const other = await produceBlendSupplyEvidence(
		{ ...input, accountId: otherAccount },
		provider({
			rows: [
				contractRow(blendFixedSupplyKeys(otherAccount).positions),
				...sharedRows.toReversed()
			]
		}).request
	);
	const reordered = await produceBlendSupplyEvidence(
		input,
		provider({ rows: rowsWithoutCode.toReversed() }).request
	);
	expect(other.documents.shared).toEqual(first.documents.shared);
	expect(other.documents.account.sha256).not.toBe(
		first.documents.account.sha256
	);
	expect(reordered).toEqual(first);
});

test.each([
	['omitted account', null],
	['unknown TTL', undefined],
	['zero TTL', 0],
	['expired TTL', ledger - 1]
] as const)(
	'keeps %s unobserved and retains the supplied fact',
	async (_label, ttl) => {
		const rows =
			ttl === null
				? sharedRows
				: [...sharedRows, { ...accountRow, liveUntilLedgerSeq: ttl }];
		const result = await produceBlendSupplyEvidence(
			input,
			provider({ rows }).request
		);
		expect(JSON.parse(result.documents.account.json).row).toEqual(
			ttl === null
				? null
				: expect.objectContaining({ liveUntilLedger: ttl ?? null })
		);
		expect(
			projectBlendFixedSupply({
				accountId,
				snapshot,
				evidence: result.adapterEvidence
			})
		).toMatchObject({ status: 'unobserved' });
	}
);

test.each([
	['duplicate', [...sharedRows, accountRow, accountRow], /duplicate/],
	[
		'unrequested',
		[...sharedRows, contractRow(blendFixedSupplyKeys(otherAccount).positions)],
		/Unexpected/
	],
	[
		'substituted account XDR',
		[
			...sharedRows,
			{
				...contractRow(blendFixedSupplyKeys(otherAccount).positions),
				key: keys.positions
			}
		],
		/data key mismatch/
	],
	[
		'tampered code bytes',
		[...rowsWithoutCode, invalidCodeRow()],
		/Wasm digest/
	],
	[
		'wrong code hash',
		[...rowsWithoutCode, invalidCodeRow(zero)],
		/code key mismatch/
	],
	[
		'future modification',
		[...sharedRows, { ...accountRow, lastModifiedLedgerSeq: ledger + 1 }],
		/ledger bounds/
	],
	[
		'noncanonical XDR',
		[...sharedRows, { ...accountRow, xdr: accountRow.xdr + '\n' }],
		/entry XDR/
	]
] as const)('rejects %s', async (_label, rows, message) => {
	await expect(
		produceBlendSupplyEvidence(input, provider({ rows }).request)
	).rejects.toThrow(message);
});

test('preserves a changed executable as an observation without following its new key', async () => {
	const { request, calls } = provider({
		rows: [
			instanceRow(xdr.ContractExecutable.contractExecutableWasm(zero)),
			...rowsWithoutCode.slice(1)
		]
	});
	const result = await produceBlendSupplyEvidence(input, request);
	expect(result.adapterEvidence).toBeUndefined();
	expect(calls).toHaveLength(3);
	expect(calls[1]?.params).toMatchObject({
		keys: expect.arrayContaining([codeKey])
	});
});

test.each([
	[{ passphrase: Networks.TESTNET }, /network mismatch/, 1],
	[{ entryLedger: ledger - 1 }, /batch ledger mismatch/, 2],
	[{ entryLedger: ledger + 1 }, /batch ledger mismatch/, 2],
	[
		{ header: { ...header, hash: 'a'.repeat(64) } },
		/header snapshot mismatch/,
		3
	],
	[{ header: headerFixture(101, header.hash) }, /header digest/, 3]
] as const)(
	'rejects mixed or unverifiable snapshots %#',
	async (options, message, callCount) => {
		const { request, calls } = provider(options);
		await expect(produceBlendSupplyEvidence(input, request)).rejects.toThrow(
			message
		);
		expect(calls).toHaveLength(callCount);
	}
);

test('rejects unsupported scope before provider work', async () => {
	const { request, calls } = provider();
	await expect(
		produceBlendSupplyEvidence(
			{ ...input, accountId: blendFixedSupplyTarget.poolId },
			request
		)
	).rejects.toThrow('Invalid Blend account');
	await expect(
		produceBlendSupplyEvidence(
			{ ...input, snapshot: { ...snapshot, networkId: 'a'.repeat(64) } },
			request
		)
	).rejects.toThrow('Invalid Blend evidence snapshot');
	await expect(
		produceBlendSupplyEvidence(
			{ ...input, rpcUrl: 'http://rpc.example.test' },
			request
		)
	).rejects.toThrow('Invalid Blend evidence provider');
	expect(calls).toEqual([]);
});

test('propagates provider throttling without retrying or calling the header endpoint', async () => {
	const { request, calls } = provider({ throttle: true });
	await expect(
		produceBlendSupplyEvidence(input, request)
	).rejects.toMatchObject({ status: 429 });
	expect(calls.map(({ method }) => method)).toEqual([
		'getNetwork',
		'getLedgerEntries'
	]);
});

test('passes a shared cancellation signal through and stops when cancelled', async () => {
	const abort = new AbortController();
	let count = 0;
	const request: NonNullable<
		Parameters<typeof produceBlendSupplyEvidence>[1]
	> = async (_url, _body, options) => {
		count++;
		abort.abort(new Error('cancelled by caller'));
		expect(options?.signal?.aborted).toBe(true);
		return {};
	};
	await expect(
		produceBlendSupplyEvidence({ ...input, signal: abort.signal }, request)
	).rejects.toThrow('cancelled by caller');
	expect(count).toBe(1);
});
