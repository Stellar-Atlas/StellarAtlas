import { createHash } from 'node:crypto';
import {
	Address,
	Asset,
	StrKey,
	scValToBigInt,
	scValToNative,
	xdr
} from '@stellar/stellar-sdk';

/** Source model: stellar/soroban-examples timelock/src/lib.rs, blob b17574c4138ce29680029288f314c4f011ae5163. */
export const timelockAdapter = 'stellar-example-timelock-v1';
const maxRegistrations = 16;
const maxEntryXdrLength = 32 * 1024;
const sha256 = /^[0-9a-f]{64}$/;

export interface PositionSnapshot {
	readonly networkId: string;
	readonly ledger: number;
	readonly ledgerHash: string;
}

/** Trusted registry. A reviewed Wasm-to-source binding is required before registration. */
export interface TimelockRegistration {
	readonly networkId: string;
	readonly contractId: string;
	readonly wasmSha256: string;
	readonly assetId: string;
}

export type TimelockEvidence = PositionSnapshot & {
	readonly contractId: string;
	readonly rawEvidenceSha256: string;
} & (
		| {
				readonly state: 'live';
				readonly modifiedLedger: number;
				readonly liveUntilLedger: number;
				readonly instanceXdr: string;
		  }
		| {
				readonly state: 'archived';
				readonly modifiedLedger: number;
				readonly liveUntilLedger: number;
		  }
		| { readonly state: 'deleted'; readonly deletedAtLedger: number }
	);

type PositionState =
	| { readonly status: 'unobserved' | 'stale' | 'invalid_evidence' }
	| {
			readonly status: 'unsupported_code';
			readonly observedWasmSha256: string | null;
	  }
	| { readonly status: 'unsupported_asset' }
	| {
			readonly status: 'archived';
			readonly modifiedLedger: number;
			readonly liveUntilLedger: number;
	  }
	| { readonly status: 'deleted'; readonly deletedAtLedger: number }
	| {
			readonly status: 'no_active_deposit' | 'not_beneficiary';
			readonly modifiedLedger: number;
			readonly liveUntilLedger: number;
	  }
	| {
			readonly status: 'observed';
			readonly modifiedLedger: number;
			readonly liveUntilLedger: number;
			readonly assetId: string;
			readonly tokenContractId: string;
			readonly amountRaw: string;
			readonly decimals: 7;
			readonly beneficiary: string;
			readonly competingBeneficiaries: readonly string[];
			readonly timeCondition: {
				readonly operator: 'at_or_before' | 'at_or_after';
				readonly epochSeconds: string;
			};
			readonly withdrawal: 'unknown';
			readonly balanceScope: 'separate_contract_deposit';
	  };

type Position = PositionState & {
	readonly contractId: string;
	readonly registeredWasmSha256: string;
	readonly evidenceSnapshot: PositionSnapshot | null;
	readonly rawEvidenceSha256: string | null;
};

/**
 * Projects one caller-selected canonical snapshot from bounded, prevalidated ledger evidence.
 * It performs no discovery, network request, eligibility simulation or wallet arithmetic.
 */
export function projectTimelockPositions(input: {
	readonly networkPassphrase: string;
	readonly accountId: string;
	readonly snapshot: PositionSnapshot;
	readonly registry: readonly TimelockRegistration[];
	readonly evidenceByContract: ReadonlyMap<string, TimelockEvidence>;
}): {
	readonly adapter: typeof timelockAdapter;
	readonly coverage: 'registered_contracts_only' | 'unsupported';
	readonly snapshot: PositionSnapshot;
	readonly accountId: string;
	readonly positions: readonly Position[];
} {
	const {
		networkPassphrase,
		accountId,
		snapshot,
		registry,
		evidenceByContract
	} = input;
	const networkId = createHash('sha256')
		.update(networkPassphrase)
		.digest('hex');
	if (
		!networkPassphrase ||
		accountId.length !== 56 ||
		!StrKey.isValidEd25519PublicKey(accountId) ||
		snapshot.networkId !== networkId ||
		!validLedger(snapshot.ledger) ||
		!sha256.test(snapshot.ledgerHash)
	)
		throw new Error('Invalid timelock projection scope');
	if (
		registry.length > maxRegistrations ||
		evidenceByContract.size > maxRegistrations
	)
		throw new Error('Timelock evidence exceeds the registry limit');

	const candidates = registry.filter((entry) => entry.networkId === networkId);
	const contracts = new Set<string>();
	const positions = candidates.map((entry): Position => {
		if (
			entry.contractId.length !== 56 ||
			!StrKey.isValidContract(entry.contractId) ||
			!sha256.test(entry.wasmSha256) ||
			contracts.has(entry.contractId)
		)
			throw new Error('Invalid or duplicate timelock registration');
		contracts.add(entry.contractId);
		const token = tokenContractId(entry.assetId, networkPassphrase);
		const evidence = evidenceByContract.get(entry.contractId);
		const result = decodePosition(entry, token, accountId, snapshot, evidence);
		const boundEvidence =
			result.status !== 'invalid_evidence' ? evidence : undefined;
		return {
			contractId: entry.contractId,
			registeredWasmSha256: entry.wasmSha256,
			evidenceSnapshot: boundEvidence
				? {
						networkId: boundEvidence.networkId,
						ledger: boundEvidence.ledger,
						ledgerHash: boundEvidence.ledgerHash
					}
				: null,
			rawEvidenceSha256: boundEvidence?.rawEvidenceSha256 ?? null,
			...result
		};
	});
	return {
		adapter: timelockAdapter,
		coverage: candidates.length ? 'registered_contracts_only' : 'unsupported',
		snapshot,
		accountId,
		positions
	};
}

function decodePosition(
	registration: TimelockRegistration,
	token: string,
	accountId: string,
	snapshot: PositionSnapshot,
	evidence: TimelockEvidence | undefined
): PositionState {
	if (!evidence) return { status: 'unobserved' };
	if (
		evidence.networkId !== snapshot.networkId ||
		evidence.contractId !== registration.contractId ||
		!validLedger(evidence.ledger) ||
		!sha256.test(evidence.ledgerHash) ||
		!sha256.test(evidence.rawEvidenceSha256)
	)
		return { status: 'invalid_evidence' };
	if (evidence.ledger < snapshot.ledger) return { status: 'stale' };
	if (
		evidence.ledger !== snapshot.ledger ||
		evidence.ledgerHash !== snapshot.ledgerHash
	)
		return { status: 'invalid_evidence' };

	if (evidence.state === 'deleted') {
		return validLedger(evidence.deletedAtLedger) &&
			evidence.deletedAtLedger <= snapshot.ledger
			? { status: 'deleted', deletedAtLedger: evidence.deletedAtLedger }
			: { status: 'invalid_evidence' };
	}
	const { modifiedLedger, liveUntilLedger } = evidence;
	if (
		!validLedger(modifiedLedger) ||
		!validLedger(liveUntilLedger) ||
		modifiedLedger > snapshot.ledger ||
		modifiedLedger > liveUntilLedger
	)
		return { status: 'invalid_evidence' };
	if (evidence.state === 'archived')
		return liveUntilLedger < snapshot.ledger
			? { status: 'archived', modifiedLedger, liveUntilLedger }
			: { status: 'invalid_evidence' };
	if (liveUntilLedger < snapshot.ledger) return { status: 'invalid_evidence' };

	try {
		const instance = decodeInstance(
			evidence.instanceXdr,
			registration.contractId
		);
		const executable = instance.executable;
		const digest =
			executable.type === 'contractExecutableWasm'
				? executable.wasmHash.toString()
				: null;
		if (digest !== registration.wasmSha256)
			return { status: 'unsupported_code', observedWasmSha256: digest };

		const storage = entries(instance.storage ?? [], enumSymbol, 2);
		const initialized = storage.get('Init');
		const balance = storage.get('Balance');
		if (
			storage.size !==
				Number(initialized !== undefined) + Number(balance !== undefined) ||
			(initialized && initialized.type !== 'scvVoid') ||
			(balance && !initialized)
		)
			throw new Error('Invalid timelock state');
		const observed = { modifiedLedger, liveUntilLedger };
		if (!balance) return { status: 'no_active_deposit', ...observed };

		const deposit = fields(balance, [
			'amount',
			'claimants',
			'time_bound',
			'token'
		]);
		const tokenAddress = readAddress(deposit.get('token'));
		if (tokenAddress !== token) return { status: 'unsupported_asset' };
		const amount = deposit.get('amount');
		if (amount?.type !== 'scvI128') throw new Error('Invalid timelock amount');
		const units = scValToBigInt(amount);
		if (units < 0n) throw new Error('Negative timelock deposit');
		const claimants = deposit.get('claimants');
		if (
			claimants?.type !== 'scvVec' ||
			!claimants.vec ||
			claimants.vec.length > 10
		)
			throw new Error('Invalid timelock beneficiaries');
		const beneficiaries = [...new Set(claimants.vec.map(readAddress))];
		const time = fields(deposit.get('time_bound'), ['kind', 'timestamp']);
		const kind = enumSymbol(time.get('kind'));
		const timestamp = time.get('timestamp');
		if ((kind !== 'Before' && kind !== 'After') || timestamp?.type !== 'scvU64')
			throw new Error('Invalid timelock time condition');

		if (!beneficiaries.includes(accountId))
			return { status: 'not_beneficiary', ...observed };
		return {
			status: 'observed',
			...observed,
			assetId: registration.assetId,
			tokenContractId: token,
			amountRaw: units.toString(),
			decimals: 7,
			beneficiary: accountId,
			competingBeneficiaries: beneficiaries.filter((id) => id !== accountId),
			timeCondition: {
				operator: kind === 'Before' ? 'at_or_before' : 'at_or_after',
				epochSeconds: scValToBigInt(timestamp).toString()
			},
			withdrawal: 'unknown',
			balanceScope: 'separate_contract_deposit'
		};
	} catch {
		return { status: 'invalid_evidence' };
	}
}

function decodeInstance(
	encoded: string,
	contractId: string
): xdr.ScContractInstance {
	if (!encoded || encoded.length > maxEntryXdrLength)
		throw new Error('Invalid instance XDR length');
	const entry = xdr.LedgerEntryData.fromXDR(encoded, 'base64');
	if (entry.toXDR('base64') !== encoded || entry.type !== 'contractData')
		throw new Error('Invalid contract instance encoding');
	const data = entry.contractData;
	if (
		data.contract.toXDR('base64') !==
			new Address(contractId).toScAddress().toXDR('base64') ||
		data.key.type !== 'scvLedgerKeyContractInstance' ||
		data.durability !== xdr.ContractDataDurability.persistent ||
		data.val.type !== 'scvContractInstance'
	)
		throw new Error('Contract instance identity mismatch');
	return data.val.instance;
}

function entries(
	items: readonly xdr.ScMapEntry[],
	keyOf: (value: xdr.ScVal) => string,
	limit: number
): Map<string, xdr.ScVal> {
	if (items.length > limit) throw new Error('Too many timelock fields');
	const map = new Map<string, xdr.ScVal>();
	for (const item of items) {
		const key = keyOf(item.key);
		if (map.has(key)) throw new Error('Duplicate timelock field');
		map.set(key, item.val);
	}
	return map;
}

function fields(
	value: xdr.ScVal | undefined,
	names: readonly string[]
): Map<string, xdr.ScVal> {
	if (value?.type !== 'scvMap' || !value.map)
		throw new Error('Invalid timelock struct');
	const map = entries(value.map, symbol, names.length);
	if (!names.every((name) => map.has(name)))
		throw new Error('Missing timelock struct field');
	return map;
}

function symbol(value: xdr.ScVal): string {
	if (value.type !== 'scvSymbol') throw new Error('Invalid timelock symbol');
	const name: unknown = scValToNative(value);
	if (typeof name !== 'string') throw new Error('Invalid timelock symbol');
	return name;
}

function enumSymbol(value: xdr.ScVal | undefined): string {
	if (value?.type !== 'scvVec' || value.vec?.length !== 1)
		throw new Error('Invalid timelock unit variant');
	return symbol(value.vec[0]!);
}

function readAddress(value: xdr.ScVal | undefined): string {
	if (value?.type !== 'scvAddress') throw new Error('Invalid timelock address');
	const address = Address.fromScVal(value).toString();
	if (
		!StrKey.isValidEd25519PublicKey(address) &&
		!StrKey.isValidContract(address)
	)
		throw new Error('Unsupported timelock address');
	return address;
}

function tokenContractId(assetId: string, passphrase: string): string {
	if (assetId === 'native') return Asset.native().contractId(passphrase);
	const match = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(assetId);
	if (!match?.[1] || !match[2] || !StrKey.isValidEd25519PublicKey(match[2]))
		throw new Error('Unsupported registered timelock asset');
	return new Asset(match[1], match[2]).contractId(passphrase);
}

function validLedger(ledger: number): boolean {
	return Number.isInteger(ledger) && ledger > 0 && ledger <= 0xffff_ffff;
}
