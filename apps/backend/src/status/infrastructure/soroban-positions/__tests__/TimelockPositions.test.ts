import { createHash } from 'node:crypto';
import {
	Address,
	Asset,
	Networks,
	StrKey,
	nativeToScVal,
	xdr
} from '@stellar/stellar-sdk';
import { projectTimelockPositions } from '../TimelockPositions.js';
import type {
	PositionSnapshot,
	TimelockEvidence,
	TimelockRegistration
} from '../TimelockPositions.js';

const networkPassphrase = Networks.TESTNET;
const networkId = createHash('sha256').update(networkPassphrase).digest('hex');
const beneficiary = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const competitor = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const unrelatedContract = StrKey.encodeContract(Buffer.alloc(32, 6));
const hash = Buffer.alloc(32, 7);
const wasmSha256 = hash.toString('hex');
const snapshot = { networkId, ledger: 200, ledgerHash: '8'.repeat(64) };
const rawEvidenceSha256 = '9'.repeat(64);
const registration = { networkId, contractId, wasmSha256, assetId: 'native' };
const tokenContractId = Asset.native().contractId(networkPassphrase);
const exactUnits = 170141183460469231731687303715884105727n;
const exactTimestamp = 18446744073709551615n;

const sym = (name: string) => nativeToScVal(name, { type: 'symbol' });
const tag = (name: string) => xdr.ScVal.scvVec([sym(name)]);
const entry = (key: xdr.ScVal, val: xdr.ScVal) =>
	new xdr.ScMapEntry({ key, val });
const struct = (fields: Record<string, xdr.ScVal>) =>
	xdr.ScVal.scvMap(
		Object.keys(fields)
			.sort()
			.map((key) => entry(sym(key), fields[key]!))
	);

function deposit(
	options: {
		readonly token?: string;
		readonly units?: bigint;
		readonly claimants?: readonly string[];
		readonly kind?: string;
	} = {}
): xdr.ScVal {
	return struct({
		amount: nativeToScVal(options.units ?? exactUnits, { type: 'i128' }),
		claimants: xdr.ScVal.scvVec(
			(options.claimants ?? [beneficiary, competitor]).map((id) =>
				new Address(id).toScVal()
			)
		),
		time_bound: struct({
			kind: tag(options.kind ?? 'After'),
			timestamp: nativeToScVal(exactTimestamp, { type: 'u64' })
		}),
		token: new Address(options.token ?? tokenContractId).toScVal()
	});
}

function instanceXdr(
	options: {
		readonly balance?: xdr.ScVal | null;
		readonly id?: string;
		readonly executable?: xdr.ContractExecutable;
		readonly durability?: xdr.ContractDataDurability;
		readonly duplicate?: boolean;
	} = {}
): string {
	const balance = options.balance === undefined ? deposit() : options.balance;
	const storage = balance
		? [entry(tag('Balance'), balance), entry(tag('Init'), xdr.ScVal.scvVoid())]
		: [entry(tag('Init'), xdr.ScVal.scvVoid())];
	if (options.duplicate) storage.push(entry(tag('Init'), xdr.ScVal.scvVoid()));
	return xdr.LedgerEntryData.contractData(
		new xdr.ContractDataEntry({
			ext: xdr.ExtensionPoint.v0(),
			contract: new Address(options.id ?? contractId).toScAddress(),
			key: xdr.ScVal.scvLedgerKeyContractInstance(),
			durability: options.durability ?? xdr.ContractDataDurability.persistent,
			val: xdr.ScVal.scvContractInstance(
				new xdr.ScContractInstance({
					executable:
						options.executable ??
						xdr.ContractExecutable.contractExecutableWasm(hash),
					storage
				})
			)
		})
	).toXDR('base64');
}

function live(
	xdrString = instanceXdr()
): Extract<TimelockEvidence, { state: 'live' }> {
	return {
		...snapshot,
		contractId,
		rawEvidenceSha256,
		state: 'live',
		modifiedLedger: 198,
		liveUntilLedger: 200,
		instanceXdr: xdrString
	};
}

function project(
	evidence?: TimelockEvidence,
	options: {
		readonly registry?: readonly TimelockRegistration[];
		readonly snapshot?: PositionSnapshot;
		readonly accountId?: string;
	} = {}
) {
	return projectTimelockPositions({
		networkPassphrase,
		accountId: options.accountId ?? beneficiary,
		snapshot: options.snapshot ?? snapshot,
		registry: options.registry ?? [registration],
		evidenceByContract: evidence ? new Map([[contractId, evidence]]) : new Map()
	});
}

it('preserves signed i128 units and UInt64 seconds from the instance XDR', () => {
	const result = project(live());
	expect(result).toEqual({
		adapter: 'stellar-example-timelock-v1',
		coverage: 'registered_contracts_only',
		snapshot,
		accountId: beneficiary,
		positions: [
			{
				status: 'observed',
				contractId,
				registeredWasmSha256: wasmSha256,
				evidenceSnapshot: snapshot,
				rawEvidenceSha256,
				modifiedLedger: 198,
				liveUntilLedger: 200,
				assetId: 'native',
				tokenContractId,
				amountRaw: exactUnits.toString(),
				decimals: 7,
				beneficiary,
				competingBeneficiaries: [competitor],
				timeCondition: {
					operator: 'at_or_after',
					epochSeconds: exactTimestamp.toString()
				},
				withdrawal: 'unknown',
				balanceScope: 'separate_contract_deposit'
			}
		]
	});
	expect(JSON.stringify(result)).not.toContain(live().instanceXdr);
	expect(project(live(), { accountId: competitor }).positions[0]).toMatchObject(
		{
			beneficiary: competitor,
			competingBeneficiaries: [beneficiary]
		}
	);
});

it('preserves an issued asset and the inclusive Before condition from the approved network', () => {
	const assetId = 'USD:' + competitor;
	const token = new Asset('USD', competitor).contractId(networkPassphrase);
	const result = project(
		live(
			instanceXdr({ balance: deposit({ token, units: 1n, kind: 'Before' }) })
		),
		{
			registry: [{ ...registration, assetId }]
		}
	);
	expect(result.positions[0]).toMatchObject({
		status: 'observed',
		assetId,
		tokenContractId: token,
		amountRaw: '1',
		decimals: 7,
		timeCondition: { operator: 'at_or_before' },
		withdrawal: 'unknown'
	});
});

it.each([
	[
		'different token',
		instanceXdr({ balance: deposit({ token: unrelatedContract }) }),
		'unsupported_asset'
	],
	[
		'cross-network token',
		instanceXdr({
			balance: deposit({ token: Asset.native().contractId(Networks.PUBLIC) })
		}),
		'unsupported_asset'
	],
	[
		'built-in Stellar Asset Contract',
		instanceXdr({
			executable: xdr.ContractExecutable.contractExecutableStellarAsset()
		}),
		'unsupported_code'
	],
	[
		'changed Wasm',
		instanceXdr({
			executable: xdr.ContractExecutable.contractExecutableWasm(
				Buffer.alloc(32, 10)
			)
		}),
		'unsupported_code'
	],
	[
		'unrelated XDR identity',
		instanceXdr({ id: unrelatedContract }),
		'invalid_evidence'
	],
	[
		'temporary entry',
		instanceXdr({ durability: xdr.ContractDataDurability.temporary }),
		'invalid_evidence'
	],
	[
		'negative amount',
		instanceXdr({ balance: deposit({ units: -1n }) }),
		'invalid_evidence'
	],
	[
		'too many claimants',
		instanceXdr({
			balance: deposit({ claimants: Array<string>(11).fill(beneficiary) })
		}),
		'invalid_evidence'
	],
	['duplicate state key', instanceXdr({ duplicate: true }), 'invalid_evidence'],
	['malformed or oversized XDR', 'A'.repeat(32 * 1024 + 4), 'invalid_evidence']
])('withholds amounts for %s', (_reason, xdrString, status) => {
	const position = project(live(xdrString)).positions[0];
	expect(position?.status).toBe(status);
	expect(position).not.toHaveProperty('amountRaw');
});

it('separates no registry, missing evidence, excluded beneficiaries, and archival from zero amounts', () => {
	expect(project(undefined, { registry: [] })).toMatchObject({
		coverage: 'unsupported',
		positions: []
	});
	expect(project().positions[0]).toMatchObject({
		status: 'unobserved',
		rawEvidenceSha256: null
	});
	expect(
		project(live(), {
			accountId: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2))
		}).positions[0]
	).toMatchObject({ status: 'not_beneficiary' });
	const archived = project({
		...snapshot,
		contractId,
		rawEvidenceSha256,
		state: 'archived',
		modifiedLedger: 190,
		liveUntilLedger: 199
	}).positions[0];
	expect(archived).toMatchObject({
		status: 'archived',
		liveUntilLedger: 199,
		rawEvidenceSha256
	});
	expect(archived).not.toHaveProperty('amountRaw');
	expect(
		project({ ...live(), liveUntilLedger: 199 }).positions[0]?.status
	).toBe('invalid_evidence');
});

it('keeps replay idempotent and refuses stale evidence or a different fork at the selected ledger', () => {
	const earlier = live();
	expect(project(earlier)).toEqual(project(earlier));
	const next = { ...snapshot, ledger: 201, ledgerHash: 'a'.repeat(64) };
	const claimed = {
		...live(instanceXdr({ balance: null })),
		...next,
		modifiedLedger: 201,
		liveUntilLedger: 250
	};
	expect(project(claimed, { snapshot: next }).positions[0]).toMatchObject({
		status: 'no_active_deposit'
	});
	expect(project(earlier, { snapshot: next }).positions[0]).toMatchObject({
		status: 'stale',
		evidenceSnapshot: snapshot
	});
	expect(
		project({ ...claimed, ledgerHash: 'b'.repeat(64) }, { snapshot: next })
			.positions[0]?.status
	).toBe('invalid_evidence');
	expect(
		project(
			{
				...next,
				contractId,
				rawEvidenceSha256,
				state: 'deleted',
				deletedAtLedger: 201
			},
			{ snapshot: next }
		).positions[0]
	).toMatchObject({ status: 'deleted', deletedAtLedger: 201 });
	expect(
		project({ ...earlier, networkId: 'c'.repeat(64) }).positions[0]?.status
	).toBe('invalid_evidence');
});

it('enforces the registry bound and rejects duplicate registrations', () => {
	expect(() =>
		project(live(), {
			registry: Array<TimelockRegistration>(17).fill(registration)
		})
	).toThrow('registry limit');
	expect(() =>
		project(live(), { registry: [registration, registration] })
	).toThrow('duplicate');
});
