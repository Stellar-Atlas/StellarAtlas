import { createHash } from 'node:crypto';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { fetchProtocolRpcJson } from './ProtocolRpcJson.js';
import { record } from '../http/contract-provenance/ContractBuildAttestation.js';
import type {
	PositionSnapshot,
	TimelockEvidence,
	TimelockRegistration
} from './TimelockPositions.js';

const maxRegistrations = 16;
const maxInstanceXdrLength = 32 * 1024;
const maxCodeXdrLength = 512 * 1024;
const digestPattern = /^[0-9a-f]{64}$/;

type RpcMethod = 'getNetwork' | 'getLedgerEntries' | 'getLedgers';
type SourceEntry = {
	readonly key: string;
	readonly xdr: string;
	readonly xdrSha256: string;
	readonly lastModifiedLedgerSeq: number;
	readonly liveUntilLedgerSeq: number | null;
};

type ProducedEvidence = {
	readonly evidenceByContract: ReadonlyMap<string, TimelockEvidence>;
	readonly unsupportedExecutableContractIds: readonly string[];
	readonly source: {
		readonly trust: 'provider_correlated';
		readonly json: string;
		readonly sha256: string;
	} | null;
};

/**
 * Reads only operator-registered timelocks from an operator-configured RPC.
 * One state batch is correlated by sequence with a separately read header.
 * The provider asserts the network, entries and TTLs. The RPC carries no
 * atomic binding between the entry batch and that header hash.
 * Retain source.json verbatim when retaining the adapter evidence.
 */
export async function produceTimelockEvidence(
	input: {
		readonly rpcUrl: string;
		readonly networkPassphrase: string;
		readonly snapshot: PositionSnapshot;
		readonly registry: readonly TimelockRegistration[];
		readonly signal?: AbortSignal;
	},
	fetchJson: typeof fetchProtocolRpcJson = fetchProtocolRpcJson
): Promise<ProducedEvidence> {
	const { networkPassphrase, registry } = input;
	const { networkId, ledger, ledgerHash } = input.snapshot;
	if (
		!networkPassphrase ||
		hash(networkPassphrase) !== networkId ||
		!validLedger(ledger) ||
		!digestPattern.test(ledgerHash)
	)
		throw new Error('Invalid timelock evidence snapshot');
	if (registry.length > maxRegistrations)
		throw new Error('Timelock evidence exceeds the registry limit');

	const contracts = new Set<string>();
	const requestedKeys = new Map<string, 'instance' | 'code'>();
	const candidates = registry
		.filter((registration) => registration.networkId === networkId)
		.map(({ contractId, wasmSha256, assetId }) => {
			if (
				!StrKey.isValidContract(contractId) ||
				!digestPattern.test(wasmSha256) ||
				!validAsset(assetId) ||
				contracts.has(contractId)
			)
				throw new Error('Unsupported or duplicate timelock registration');
			contracts.add(contractId);

			const instance = xdr.LedgerKey.contractData(
				new xdr.LedgerKeyContractData({
					contract: new Address(contractId).toScAddress(),
					key: xdr.ScVal.scvLedgerKeyContractInstance(),
					durability: xdr.ContractDataDurability.persistent
				})
			).toXDR('base64');
			const code = codeKey(Buffer.from(wasmSha256, 'hex'));
			requestedKeys.set(instance, 'instance');
			requestedKeys.set(code, 'code');
			return { contractId, wasmSha256, assetId, instance, code };
		});

	const evidenceByContract = new Map<string, TimelockEvidence>();
	const unsupportedExecutableContractIds: string[] = [];
	if (!candidates.length)
		return {
			evidenceByContract,
			unsupportedExecutableContractIds,
			source: null
		};

	const endpoint = new URL(input.rpcUrl);
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error('Invalid timelock evidence provider');

	const deadline = AbortSignal.timeout(8_000);
	const signal = input.signal
		? AbortSignal.any([input.signal, deadline])
		: deadline;
	async function rpc(method: RpcMethod, params?: object) {
		signal.throwIfAborted();
		const reply = record(
			await fetchJson(
				endpoint,
				{ jsonrpc: '2.0', id: method, method, params },
				{ signal }
			)
		);
		signal.throwIfAborted();
		if (reply.jsonrpc !== '2.0' || reply.id !== method || 'error' in reply)
			throw new Error(`Invalid timelock provider response for ${method}`);
		return record(reply.result);
	}

	const network = await rpc('getNetwork');
	if (network.passphrase !== networkPassphrase)
		throw new Error('Timelock provider network mismatch');

	const keys = [...requestedKeys.keys()];
	const batch = await rpc('getLedgerEntries', { keys });
	if (batch.latestLedger !== ledger)
		throw new Error('Timelock entry batch ledger mismatch');
	if (!Array.isArray(batch.entries) || batch.entries.length > keys.length)
		throw new Error('Invalid timelock entry batch size');

	const entries = new Map<
		string,
		{ raw: SourceEntry; executable?: string | null }
	>();
	for (const value of batch.entries) {
		const entry = record(value);
		const { key } = entry;
		if (typeof key !== 'string' || entries.has(key))
			throw new Error('Invalid or duplicate timelock entry key');
		const kind = requestedKeys.get(key);
		if (!kind) throw new Error('Unrequested timelock entry key');
		const raw = readEntry(entry, key, kind, ledger);
		const data = xdr.LedgerEntryData.fromXDR(raw.xdr, 'base64');
		if (data.toXDR('base64') !== raw.xdr)
			throw new Error('Invalid timelock entry XDR');
		if (kind === 'code') {
			if (
				data.type !== 'contractCode' ||
				codeKey(data.contractCode.hash) !== key ||
				hash(data.contractCode.code) !== data.contractCode.hash.toString()
			)
				throw new Error('Timelock Wasm digest or code key mismatch');
			entries.set(key, { raw });
		} else {
			entries.set(key, { raw, executable: instanceExecutable(data, key) });
		}
	}

	const history = await rpc('getLedgers', {
		startLedger: ledger,
		pagination: { limit: 1 }
	});
	const headerXdr = verifyHeader(history, ledger, ledgerHash);
	const json = JSON.stringify({
		schema: 'stellar-timelock-rpc-evidence-v1',
		providerOrigin: endpoint.origin,
		providerUrlSha256: hash(endpoint.href),
		networkPassphrase,
		networkId,
		ledger,
		ledgerHash,
		headerXdr,
		registrations: candidates,
		requestedKeys: keys,
		entries: keys.flatMap((key) => {
			const entry = entries.get(key);
			return entry ? [entry.raw] : [];
		})
	});
	const sha256 = hash(json);

	for (const candidate of candidates) {
		const instance = entries.get(candidate.instance);
		if (!instance || !liveAt(instance.raw, ledger)) continue;
		if (instance.executable !== candidate.wasmSha256) {
			unsupportedExecutableContractIds.push(candidate.contractId);
			continue;
		}
		const code = entries.get(candidate.code);
		if (!code || !liveAt(code.raw, ledger)) continue;
		evidenceByContract.set(candidate.contractId, {
			networkId,
			ledger,
			ledgerHash,
			contractId: candidate.contractId,
			rawEvidenceSha256: sha256,
			state: 'live',
			modifiedLedger: instance.raw.lastModifiedLedgerSeq,
			liveUntilLedger: instance.raw.liveUntilLedgerSeq,
			instanceXdr: instance.raw.xdr
		});
	}

	return {
		evidenceByContract,
		unsupportedExecutableContractIds,
		source: { trust: 'provider_correlated', json, sha256 }
	};
}

function readEntry(
	entry: Record<string, unknown>,
	key: string,
	kind: 'instance' | 'code',
	ledger: number
): SourceEntry {
	const { xdr: encoded, lastModifiedLedgerSeq, liveUntilLedgerSeq } = entry;
	const maxLength =
		kind === 'instance' ? maxInstanceXdrLength : maxCodeXdrLength;
	if (
		typeof encoded !== 'string' ||
		!encoded ||
		encoded.length > maxLength ||
		!validLedger(lastModifiedLedgerSeq) ||
		lastModifiedLedgerSeq > ledger ||
		(liveUntilLedgerSeq !== undefined &&
			liveUntilLedgerSeq !== 0 &&
			(!validLedger(liveUntilLedgerSeq) ||
				liveUntilLedgerSeq < lastModifiedLedgerSeq))
	)
		throw new Error('Invalid timelock entry content or ledger bounds');

	return {
		key,
		xdr: encoded,
		xdrSha256: hash(Buffer.from(encoded, 'base64')),
		lastModifiedLedgerSeq,
		liveUntilLedgerSeq: liveUntilLedgerSeq ?? null
	};
}

function liveAt(
	entry: SourceEntry,
	ledger: number
): entry is SourceEntry & { liveUntilLedgerSeq: number } {
	return (
		entry.liveUntilLedgerSeq !== null && entry.liveUntilLedgerSeq >= ledger
	);
}

function codeKey(digest: Buffer | xdr.Hash): string {
	return xdr.LedgerKey.contractCode(
		new xdr.LedgerKeyContractCode({ hash: digest })
	).toXDR('base64');
}

function instanceExecutable(
	data: xdr.LedgerEntryData,
	key: string
): string | null {
	if (data.type !== 'contractData')
		throw new Error('Timelock instance key mismatch');
	const { contract, key: dataKey, durability, val } = data.contractData;
	if (
		val.type !== 'scvContractInstance' ||
		xdr.LedgerKey.contractData(
			new xdr.LedgerKeyContractData({ contract, key: dataKey, durability })
		).toXDR('base64') !== key
	)
		throw new Error('Timelock instance key mismatch');

	const executable = val.instance.executable;
	return executable.type === 'contractExecutableWasm'
		? executable.wasmHash.toString()
		: null;
}

function verifyHeader(
	history: Record<string, unknown>,
	ledger: number,
	ledgerHash: string
): string {
	if (
		!validLedger(history.latestLedger) ||
		history.latestLedger < ledger ||
		!Array.isArray(history.ledgers) ||
		history.ledgers.length !== 1
	)
		throw new Error('Invalid timelock provider ledger history');
	const {
		sequence,
		hash: reportedHash,
		headerXdr
	} = record(history.ledgers[0]);
	if (
		sequence !== ledger ||
		reportedHash !== ledgerHash ||
		typeof headerXdr !== 'string' ||
		!headerXdr ||
		headerXdr.length > 16 * 1024
	)
		throw new Error('Timelock header snapshot mismatch');

	const historyEntry = xdr.LedgerHeaderHistoryEntry.fromXDR(
		headerXdr,
		'base64'
	);
	if (
		historyEntry.toXDR('base64') !== headerXdr ||
		historyEntry.hash.toString() !== ledgerHash ||
		historyEntry.header.ledgerSeq !== ledger ||
		hash(historyEntry.header.toXDR()) !== ledgerHash
	)
		throw new Error('Timelock header digest or sequence mismatch');
	return headerXdr;
}

function validAsset(assetId: string): boolean {
	if (assetId === 'native') return true;
	const match = /^[A-Za-z0-9]{1,12}:(G[A-Z2-7]{55})$/.exec(assetId);
	return !!match?.[1] && StrKey.isValidEd25519PublicKey(match[1]);
}

function validLedger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 0xffff_ffff
	);
}

function hash(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
