import { createHash } from 'node:crypto';
import {
	Address,
	Networks,
	StrKey,
	nativeToScVal,
	xdr
} from '@stellar/stellar-sdk';
import {
	blendFixedSupplyKeys,
	projectBlendFixedSupply
} from '../BlendFixedSupply.js';

const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const otherAccount = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const otherAsset = StrKey.encodeContract(Buffer.alloc(32, 5));
const otherPool = StrKey.encodeContract(Buffer.alloc(32, 6));
const poolId = 'CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO';
const xlm = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const wasm = 'a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e';
const networkId = createHash('sha256').update(Networks.PUBLIC).digest('hex');
const snapshot = { networkId, ledger: 65328809, ledgerHash: '1'.repeat(64) };
const rawEvidenceSha256 = '2'.repeat(64);
const rate = 1_000_103_544_200n;
const largeShares = 9_007_199_254_740_993n;
const maxI128 = (1n << 127n) - 1n;

const sym = (name: string) => nativeToScVal(name, { type: 'symbol' });
const address = (id: string) => new Address(id).toScVal();
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const u64 = (n: bigint) => nativeToScVal(n, { type: 'u64' });
const tupleKey = (tag: string, id: string) =>
	xdr.ScVal.scvVec([sym(tag), address(id)]);
const pair = (key: xdr.ScVal, val: xdr.ScVal) =>
	new xdr.ScMapEntry({ key, val });
const struct = (fields: Record<string, xdr.ScVal>) =>
	xdr.ScVal.scvMap(
		Object.keys(fields)
			.sort()
			.map((key) => pair(sym(key), fields[key]!))
	);
const balances = (...entries: [number, bigint][]) =>
	xdr.ScVal.scvMap(
		entries.map(([index, value]) => pair(u32(index), i128(value)))
	);

const instanceKey = xdr.ScVal.scvLedgerKeyContractInstance();
const reserveListKey = sym('ResList');
const configKey = tupleKey('ResConfig', xlm);
const dataKey = tupleKey('ResData', xlm);
const positionsKey = tupleKey('Positions', accountId);

function row(
	key: xdr.ScVal,
	val: xdr.ScVal,
	contractId = poolId,
	durability = xdr.ContractDataDurability.persistent
) {
	const identity = {
		contract: new Address(contractId).toScAddress(),
		key,
		durability
	};
	return {
		...snapshot,
		state: 'live' as const,
		key: xdr.LedgerKey.contractData(
			new xdr.LedgerKeyContractData(identity)
		).toXDR('base64'),
		xdr: xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				...identity,
				val,
				ext: xdr.ExtensionPoint.v0()
			})
		).toXDR('base64'),
		modifiedLedger: snapshot.ledger - 1,
		liveUntilLedger: snapshot.ledger
	};
}

function instance(
	executable = xdr.ContractExecutable.contractExecutableWasm(
		Buffer.from(wasm, 'hex')
	)
) {
	return xdr.ScVal.scvContractInstance(
		new xdr.ScContractInstance({ executable, storage: [] })
	);
}

function config(index = 0, decimals = 7) {
	return struct({
		c_factor: u32(0),
		decimals: u32(decimals),
		enabled: xdr.ScVal.scvBool(true),
		index: u32(index),
		l_factor: u32(0),
		max_util: u32(9_000_000),
		r_base: u32(10_000),
		r_one: u32(0),
		r_two: u32(0),
		r_three: u32(0),
		reactivity: u32(0),
		supply_cap: i128(100_000_000_000n),
		util: u32(8_000_000)
	});
}

function reserveData(bRate = rate) {
	return struct({
		b_rate: i128(bRate),
		b_supply: i128(100_000_000_000n),
		backstop_credit: i128(0n),
		d_rate: i128(1_000_000_000_000n),
		d_supply: i128(9n),
		ir_mod: i128(1n),
		last_time: u64(1_793_930_000n)
	});
}

function positions(supply = balances([0, largeShares], [1, 70n])) {
	return struct({
		collateral: balances([0, 500n]),
		liabilities: balances([0, 200n]),
		supply
	});
}

const list = xdr.ScVal.scvVec([address(xlm), address(otherAsset)]);
const entries = [
	row(instanceKey, instance()),
	row(reserveListKey, list),
	row(configKey, config()),
	row(dataKey, reserveData()),
	row(positionsKey, positions())
] as const;
const keys = blendFixedSupplyKeys(accountId);
type Evidence = NonNullable<
	Parameters<typeof projectBlendFixedSupply>[0]['evidence']
>;
type Entry = Evidence['entries'][number];

function project(
	rows: readonly Entry[] = entries,
	selected = snapshot,
	id = accountId
) {
	return projectBlendFixedSupply({
		accountId: id,
		snapshot: selected,
		evidence: { rawEvidenceSha256, entries: rows }
	});
}

function replace(key: string, entry: Entry) {
	return entries.map((candidate) =>
		candidate.key === key ? entry : candidate
	);
}

test('derives five exact persistent Mainnet pool keys with one explicit G-account', () => {
	expect(keys).toEqual({
		instance: entries[0].key,
		reserveList: entries[1].key,
		reserveConfig: entries[2].key,
		reserveData: entries[3].key,
		positions: entries[4].key
	});
	expect(keys.reserveConfig).toBe(
		'AAAABgAAAAFAoGaESEBQaGIwYy1ZSZ7K1DEhPMq/+Bj92AqRDYNaiAAAABAAAAABAAAAAgAAAA8AAAAJUmVzQ29uZmlnAAAAAAAAEgAAAAEltPzYWa7C+mNIQ4xImzw8EMmLbSG+T9PLMMtolT75dwAAAAE='
	);
	expect(blendFixedSupplyKeys(otherAccount)).toEqual({
		...keys,
		positions: row(tupleKey('Positions', otherAccount), positions()).key
	});
	expect(blendFixedSupplyKeys(otherAccount).positions).not.toBe(keys.positions);
	expect(() => blendFixedSupplyKeys(poolId)).toThrow('Invalid Blend account');
});

test('projects only non-collateral supply with exact integer flooring beyond JS safe precision', () => {
	expect(project()).toEqual({
		adapter: 'blend-fixed-v2.1-native-xlm-supply',
		status: 'observed',
		poolId,
		accountId,
		snapshot,
		rawEvidenceSha256,
		wasmSha256: wasm,
		assetId: 'native',
		assetContractId: xlm,
		reserveIndex: 0,
		supplySharesRaw: '9007199254740993',
		supplyShareDecimals: 7,
		underlyingEstimate: {
			kind: 'stored_rate',
			amountRaw: '9008131897982065',
			decimals: 7,
			rateRaw: '1000103544200',
			rateDecimals: 12,
			rateUpdatedAtEpochSeconds: '1793930000'
		},
		balanceScope: 'separate_protocol_supply',
		withdrawal: 'unknown'
	});
	expect(project([...entries].reverse())).toEqual(project());
});

test.each([
	['zero shares', balances([0, 0n])],
	['other-reserve shares only', balances([1, 50n])],
	['empty supply map', balances()]
])(
	'reports observed zero non-collateral XLM supply for %s',
	(_case, supply) => {
		expect(
			project(replace(keys.positions, row(positionsKey, positions(supply))))
		).toMatchObject({
			status: 'observed',
			supplySharesRaw: '0',
			underlyingEstimate: { kind: 'stored_rate', amountRaw: '0' },
			withdrawal: 'unknown'
		});
	}
);

test('floors fractional smallest units without precision loss or intermediate i128 overflow', () => {
	expect(
		project(
			replace(keys.positions, row(positionsKey, positions(balances([0, 1n]))))
		)
	).toMatchObject({
		status: 'observed',
		supplySharesRaw: '1',
		underlyingEstimate: { amountRaw: '1' }
	});
	const big = replace(
		keys.positions,
		row(positionsKey, positions(balances([0, maxI128])))
	);
	expect(project(big)).toMatchObject({
		status: 'unobserved',
		reason: 'invalid_evidence'
	});
	expect(
		project(
			big.map((entry) =>
				entry.key === keys.reserveData
					? row(dataKey, reserveData(1_000_000_000_000n))
					: entry
			)
		)
	).toMatchObject({
		status: 'observed',
		supplySharesRaw: maxI128.toString(),
		underlyingEstimate: { amountRaw: maxI128.toString() }
	});
});

test('leaves absent user evidence unobserved even with a complete reserve', () => {
	expect(project(entries.slice(0, -1))).toMatchObject({
		status: 'unobserved',
		reason: 'missing_evidence'
	});
	expect(projectBlendFixedSupply({ accountId, snapshot })).toMatchObject({
		status: 'unobserved',
		reason: 'missing_evidence'
	});
});

test.each([
	[
		'account mismatch',
		tupleKey('Positions', otherAccount),
		poolId,
		xdr.ContractDataDurability.persistent
	],
	[
		'pool mismatch',
		positionsKey,
		otherPool,
		xdr.ContractDataDurability.persistent
	],
	['temporary key', positionsKey, poolId, xdr.ContractDataDurability.temporary]
] as const)(
	'rejects substituted position XDR for %s',
	(_case, key, contract, durability) => {
		const wrong = row(key, positions(), contract, durability);
		expect(
			project(replace(keys.positions, { ...wrong, key: keys.positions }))
		).toMatchObject({
			status: 'unobserved',
			reason: 'invalid_evidence'
		});
		expect(project(replace(keys.positions, wrong))).toMatchObject({
			status: 'unobserved',
			reason: 'invalid_evidence'
		});
	}
);

test.each([
	[
		'wrong reserve list',
		keys.reserveList,
		row(reserveListKey, xdr.ScVal.scvVec([address(otherAsset), address(xlm)]))
	],
	['wrong reserve index', keys.reserveConfig, row(configKey, config(1))],
	['wrong precision', keys.reserveConfig, row(configKey, config(0, 6))],
	[
		'wrong reserve key in XDR',
		keys.reserveConfig,
		{
			...row(tupleKey('ResConfig', otherAsset), config()),
			key: keys.reserveConfig
		}
	],
	[
		'wrong reserve data in XDR',
		keys.reserveData,
		{
			...row(tupleKey('ResData', otherAsset), reserveData()),
			key: keys.reserveData
		}
	],
	['zero rate', keys.reserveData, row(dataKey, reserveData(0n))],
	[
		'negative shares',
		keys.positions,
		row(positionsKey, positions(balances([0, -1n])))
	],
	[
		'duplicate index',
		keys.positions,
		row(positionsKey, positions(balances([0, 1n], [0, 2n])))
	],
	[
		'unknown index',
		keys.positions,
		row(positionsKey, positions(balances([2, 1n])))
	],
	[
		'missing liabilities field',
		keys.positions,
		row(
			positionsKey,
			struct({
				supply: balances([0, 1n]),
				collateral: balances(),
				debt: balances()
			})
		)
	]
] as const)('leaves %s unobserved', (_case, key, value) => {
	expect(project(replace(key, value))).toMatchObject({
		status: 'unobserved',
		reason: 'invalid_evidence'
	});
});

test.each([
	xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)),
	xdr.ContractExecutable.contractExecutableStellarAsset()
])('leaves changed or unsupported executables unobserved %#', (executable) => {
	expect(
		project(replace(keys.instance, row(instanceKey, instance(executable))))
	).toMatchObject({
		status: 'unobserved',
		reason: 'unsupported_code'
	});
});

test('requires a Mainnet snapshot and checks all entries for the same sequence and hash', () => {
	const wrongNetwork = '3'.repeat(64);
	expect(
		project(entries, { ...snapshot, networkId: wrongNetwork })
	).toMatchObject({
		status: 'unobserved',
		reason: 'unsupported_scope'
	});
	expect(project(entries, snapshot, poolId)).toMatchObject({
		status: 'unobserved',
		reason: 'unsupported_scope'
	});
	for (const drift of [
		{ networkId: wrongNetwork },
		{ ledger: snapshot.ledger - 1 },
		{ ledger: snapshot.ledger + 1 },
		{ ledgerHash: '4'.repeat(64) }
	]) {
		expect(
			project(replace(keys.positions, { ...entries[4], ...drift }))
		).toMatchObject({
			status: 'unobserved',
			reason: 'snapshot_mismatch'
		});
	}
});

test.each(['archived', 'deleted'] as const)(
	'leaves %s evidence unobserved',
	(state) => {
		expect(
			project(
				replace(keys.positions, { ...snapshot, key: keys.positions, state })
			)
		).toMatchObject({
			status: 'unobserved',
			reason: 'non_live_evidence'
		});
	}
);

test('accepts the inclusive TTL boundary and rejects expired, unknown and inconsistent TTLs', () => {
	expect(project()).toMatchObject({ status: 'observed' });
	expect(
		project(
			replace(keys.reserveData, {
				...entries[3],
				liveUntilLedger: snapshot.ledger - 1
			})
		)
	).toMatchObject({
		status: 'unobserved',
		reason: 'non_live_evidence'
	});
	for (const update of [
		{ liveUntilLedger: 0 },
		{ liveUntilLedger: snapshot.ledger - 2 },
		{ modifiedLedger: snapshot.ledger + 1 }
	]) {
		expect(
			project(replace(keys.reserveData, { ...entries[3], ...update }))
		).toMatchObject({
			status: 'unobserved',
			reason: 'invalid_evidence'
		});
	}
});

test('rejects duplicates, invalid raw references and noncanonical XDR', () => {
	expect(project(replace(keys.positions, entries[0]))).toMatchObject({
		status: 'unobserved',
		reason: 'invalid_evidence'
	});
	expect(
		projectBlendFixedSupply({
			accountId,
			snapshot,
			evidence: { rawEvidenceSha256: 'bad', entries }
		})
	).toMatchObject({
		status: 'unobserved',
		reason: 'invalid_evidence'
	});
	expect(
		project(
			replace(keys.positions, { ...entries[4], xdr: entries[4].xdr + '\n' })
		)
	).toMatchObject({
		status: 'unobserved',
		reason: 'invalid_evidence'
	});
});
