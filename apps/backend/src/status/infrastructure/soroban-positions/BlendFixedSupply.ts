import { createHash } from 'node:crypto';
import {
	Address,
	Asset,
	Networks,
	StrKey,
	nativeToScVal,
	scValToBigInt,
	scValToNative,
	xdr
} from '@stellar/stellar-sdk';
import type { PositionSnapshot } from './TimelockPositions.js';

/** Blend V2 pool release source c19abee5b9be4f49e0cda9057e87d343e5dcc095. */
export const blendFixedSupplyAdapter = 'blend-fixed-v2.1-native-xlm-supply';
const networkId = createHash('sha256').update(Networks.PUBLIC).digest('hex');
const poolId = 'CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO';
const wasmSha256 =
	'a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e';
const nativeSac = Asset.native().contractId(Networks.PUBLIC);
export const blendFixedSupplyTarget = Object.freeze({
	networkId,
	poolId,
	wasmSha256
});
const reserveIndex = 0;
const assetDecimals = 7;
const rateDecimals = 12;
const rateScale = 1_000_000_000_000n;
const maxI128 = (1n << 127n) - 1n;
const maxReserves = 30;
const maxEntryXdrLength = 32 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/;

type BlendEntry = PositionSnapshot & {
	readonly key: string;
} & (
		| {
				readonly state: 'live';
				readonly xdr: string;
				readonly modifiedLedger: number;
				readonly liveUntilLedger: number;
		  }
		| { readonly state: 'archived' | 'deleted' }
	);

export interface BlendSupplyEvidence {
	/** Digest of the caller's retained account-scoped raw evidence package. */
	readonly rawEvidenceSha256: string;
	readonly entries: readonly BlendEntry[];
}

type UnobservedReason =
	| 'unsupported_scope'
	| 'missing_evidence'
	| 'non_live_evidence'
	| 'snapshot_mismatch'
	| 'unsupported_code'
	| 'invalid_evidence';

type SupplyPosition = {
	readonly adapter: typeof blendFixedSupplyAdapter;
	readonly poolId: string;
	readonly accountId: string;
	readonly snapshot: PositionSnapshot;
} & (
	| { readonly status: 'unobserved'; readonly reason: UnobservedReason }
	| {
			readonly status: 'observed';
			readonly rawEvidenceSha256: string;
			readonly wasmSha256: string;
			readonly assetId: 'native';
			readonly assetContractId: string;
			readonly reserveIndex: 0;
			readonly supplySharesRaw: string;
			readonly supplyShareDecimals: 7;
			readonly underlyingEstimate: {
				readonly kind: 'stored_rate';
				readonly amountRaw: string;
				readonly decimals: 7;
				readonly rateRaw: string;
				readonly rateDecimals: 12;
				readonly rateUpdatedAtEpochSeconds: string;
			};
			readonly balanceScope: 'separate_protocol_supply';
			readonly withdrawal: 'unknown';
	  }
);

const instanceKey = xdr.ScVal.scvLedgerKeyContractInstance();
const poolAddress = new Address(poolId).toScAddress();
const symbol = (value: string) => nativeToScVal(value, { type: 'symbol' });
const nativeSacValue = new Address(nativeSac).toScVal();

function persistentKey(key: xdr.ScVal, contract = poolAddress): string {
	return xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({
			contract,
			key,
			durability: xdr.ContractDataDurability.persistent
		})
	).toXDR('base64');
}

const fixedKeys = {
	instance: persistentKey(instanceKey),
	reserveList: persistentKey(symbol('ResList')),
	reserveConfig: persistentKey(
		xdr.ScVal.scvVec([symbol('ResConfig'), nativeSacValue])
	),
	reserveData: persistentKey(
		xdr.ScVal.scvVec([symbol('ResData'), nativeSacValue])
	)
};

/** Exact key set for one checksum-valid G-account in the supported pool. */
export function blendFixedSupplyKeys(accountId: string) {
	if (!validAccount(accountId)) throw new Error('Invalid Blend account');
	return {
		...fixedKeys,
		positions: persistentKey(
			xdr.ScVal.scvVec([symbol('Positions'), new Address(accountId).toScVal()])
		)
	};
}

/**
 * Offline projection for one selected Mainnet snapshot. The caller supplies
 * provider-validated rows and retains the package referenced by its digest.
 * The instance executable must match the previously reviewed release hash.
 */
export function projectBlendFixedSupply(input: {
	readonly accountId: string;
	readonly snapshot: PositionSnapshot;
	readonly evidence?: BlendSupplyEvidence;
}): SupplyPosition {
	const { accountId, snapshot, evidence } = input;
	const position = {
		adapter: blendFixedSupplyAdapter,
		poolId,
		accountId,
		snapshot
	} as const;
	const unobserved = (reason: UnobservedReason): SupplyPosition => ({
		...position,
		status: 'unobserved',
		reason
	});
	if (
		!validAccount(accountId) ||
		snapshot.networkId !== networkId ||
		!validLedger(snapshot.ledger) ||
		!sha256Pattern.test(snapshot.ledgerHash)
	)
		return unobserved('unsupported_scope');
	if (!evidence) return unobserved('missing_evidence');

	const keys = blendFixedSupplyKeys(accountId);
	const requested = new Set(Object.values(keys));
	if (
		!sha256Pattern.test(evidence.rawEvidenceSha256) ||
		evidence.entries.length > requested.size
	)
		return unobserved('invalid_evidence');

	const rows = new Map<string, xdr.ScVal>();
	try {
		for (const row of evidence.entries) {
			if (!requested.has(row.key) || rows.has(row.key))
				return unobserved('invalid_evidence');
			if (
				row.networkId !== snapshot.networkId ||
				row.ledger !== snapshot.ledger ||
				row.ledgerHash !== snapshot.ledgerHash
			)
				return unobserved('snapshot_mismatch');
			if (row.state !== 'live') return unobserved('non_live_evidence');
			if (
				!validLedger(row.modifiedLedger) ||
				row.modifiedLedger > snapshot.ledger ||
				!validLedger(row.liveUntilLedger) ||
				row.liveUntilLedger < row.modifiedLedger
			)
				return unobserved('invalid_evidence');
			if (row.liveUntilLedger < snapshot.ledger)
				return unobserved('non_live_evidence');
			rows.set(row.key, decodeRow(row.key, row.xdr));
		}
		if (rows.size !== requested.size) return unobserved('missing_evidence');

		const instance = rows.get(keys.instance);
		if (instance?.type !== 'scvContractInstance')
			return unobserved('invalid_evidence');
		const executable = instance.instance.executable;
		if (
			executable.type !== 'contractExecutableWasm' ||
			executable.wasmHash.toString() !== wasmSha256
		)
			return unobserved('unsupported_code');

		const reserveCount = nativeReserveCount(rows.get(keys.reserveList));
		const config = symbolFields(rows.get(keys.reserveConfig), 13);
		if (
			readU32(config.get('index')) !== reserveIndex ||
			readU32(config.get('decimals')) !== assetDecimals
		)
			return unobserved('invalid_evidence');

		const data = symbolFields(rows.get(keys.reserveData), 7);
		const rate = readI128(data.get('b_rate'));
		const lastTime = data.get('last_time');
		if (rate <= 0n || lastTime?.type !== 'scvU64')
			return unobserved('invalid_evidence');

		const positions = symbolFields(rows.get(keys.positions), 3);
		const shares = positionShares(positions.get('supply'), reserveCount);
		// Validate the other buckets while keeping their amounts out of this projection.
		positionShares(positions.get('collateral'), reserveCount);
		positionShares(positions.get('liabilities'), reserveCount);
		const amount = (shares * rate) / rateScale;
		if (amount > maxI128) return unobserved('invalid_evidence');

		return {
			...position,
			status: 'observed',
			rawEvidenceSha256: evidence.rawEvidenceSha256,
			wasmSha256,
			assetId: 'native',
			assetContractId: nativeSac,
			reserveIndex,
			supplySharesRaw: shares.toString(),
			supplyShareDecimals: assetDecimals,
			underlyingEstimate: {
				kind: 'stored_rate',
				amountRaw: amount.toString(),
				decimals: assetDecimals,
				rateRaw: rate.toString(),
				rateDecimals,
				rateUpdatedAtEpochSeconds: scValToBigInt(lastTime).toString()
			},
			balanceScope: 'separate_protocol_supply',
			withdrawal: 'unknown'
		};
	} catch {
		return unobserved('invalid_evidence');
	}
}

function decodeRow(key: string, encoded: string): xdr.ScVal {
	if (!encoded || encoded.length > maxEntryXdrLength)
		throw new Error('Invalid Blend entry XDR size');
	const entry = xdr.LedgerEntryData.fromXDR(encoded, 'base64');
	if (entry.type !== 'contractData' || entry.toXDR('base64') !== encoded)
		throw new Error('Invalid Blend entry XDR');
	const { contract, key: dataKey, durability, val } = entry.contractData;
	if (
		durability !== xdr.ContractDataDurability.persistent ||
		persistentKey(dataKey, contract) !== key
	)
		throw new Error('Blend entry key mismatch');
	return val;
}

function nativeReserveCount(value: xdr.ScVal | undefined): number {
	if (
		value?.type !== 'scvVec' ||
		!value.vec?.length ||
		value.vec.length > maxReserves
	)
		throw new Error('Invalid Blend reserve list');
	const assets = value.vec.map((item) => {
		if (item.type !== 'scvAddress')
			throw new Error('Invalid Blend reserve address');
		const address = Address.fromScVal(item).toString();
		if (!StrKey.isValidContract(address))
			throw new Error('Invalid Blend reserve contract');
		return address;
	});
	if (
		assets[reserveIndex] !== nativeSac ||
		new Set(assets).size !== assets.length
	)
		throw new Error('Blend native reserve mismatch');
	return assets.length;
}

function symbolFields(
	value: xdr.ScVal | undefined,
	size: number
): Map<string, xdr.ScVal> {
	if (value?.type !== 'scvMap' || value.map?.length !== size)
		throw new Error('Invalid Blend struct size');
	const fields = new Map<string, xdr.ScVal>();
	for (const { key, val } of value.map) {
		const field: unknown =
			key.type === 'scvSymbol' ? scValToNative(key) : undefined;
		if (typeof field !== 'string' || fields.has(field))
			throw new Error('Invalid or duplicate Blend field');
		fields.set(field, val);
	}
	return fields;
}

function positionShares(
	value: xdr.ScVal | undefined,
	reserveCount: number
): bigint {
	if (value?.type !== 'scvMap' || !value.map || value.map.length > reserveCount)
		throw new Error('Invalid Blend position map');
	const indices = new Set<number>();
	let shares = 0n;
	for (const { key, val } of value.map) {
		const index = readU32(key);
		const amount = readI128(val);
		if (index >= reserveCount || indices.has(index) || amount < 0n)
			throw new Error('Invalid Blend position share or index');
		indices.add(index);
		if (index === reserveIndex) shares = amount;
	}
	return shares;
}

function readU32(value: xdr.ScVal | undefined): number {
	if (value?.type !== 'scvU32') throw new Error('Expected Blend u32');
	return value.u32;
}

function readI128(value: xdr.ScVal | undefined): bigint {
	if (value?.type !== 'scvI128') throw new Error('Expected Blend i128');
	return scValToBigInt(value);
}

function validLedger(ledger: number): boolean {
	return Number.isInteger(ledger) && ledger > 0 && ledger <= 0xffff_ffff;
}

function validAccount(accountId: string): boolean {
	return accountId.length === 56 && StrKey.isValidEd25519PublicKey(accountId);
}
