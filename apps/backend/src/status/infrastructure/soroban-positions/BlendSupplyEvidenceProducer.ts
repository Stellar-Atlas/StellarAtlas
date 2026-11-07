import { createHash } from 'node:crypto';
import { Networks, xdr } from '@stellar/stellar-sdk';
import { fetchProvenanceJson } from '../http/contract-provenance/BoundedProvenanceJson.js';
import { record } from '../http/contract-provenance/ContractBuildAttestation.js';
import {
	blendFixedSupplyKeys,
	blendFixedSupplyTarget,
	type BlendSupplyEvidence
} from './BlendFixedSupply.js';
import type { PositionSnapshot } from './TimelockPositions.js';

const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;
const codeKey = xdr.LedgerKey.contractCode(
	new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmSha256, 'hex') })
).toXDR('base64');
const digestPattern = /^[0-9a-f]{64}$/;

type RpcMethod = 'getNetwork' | 'getLedgerEntries' | 'getLedgers';
type RawRow = {
	readonly key: string;
	readonly xdr: string;
	readonly xdrSha256: string;
	readonly modifiedLedger: number;
	readonly liveUntilLedger: number | null;
};

interface EvidenceDocument {
	readonly sha256: string;
	/** Exact UTF-8 document bytes, represented as a string. */
	readonly json: string;
}

interface ProducedBlendSupplyEvidence {
	readonly trust: 'provider_correlated';
	readonly documents: {
		readonly code: EvidenceDocument | null;
		readonly shared: EvidenceDocument;
		readonly account: EvidenceDocument;
	};
	/** Caller must durably retain the linked documents before serving this evidence. */
	readonly adapterEvidence: BlendSupplyEvidence | undefined;
}

/**
 * One explicitly admitted account read against an operator-configured provider.
 * The entries endpoint supplies a sequence. The separately hashed header
 * correlates that sequence with the selected snapshot. The provider asserts
 * network, entries and TTLs, without an atomic state-to-header binding.
 *
 * Callers retain the code, shared and account documents by digest, in that
 * dependency order, before publishing a reference. Serving must admit and
 * coalesce work outside this function. This function makes no retries.
 */
export async function produceBlendSupplyEvidence(
	input: {
		readonly rpcUrl: string;
		readonly accountId: string;
		readonly snapshot: PositionSnapshot;
		readonly signal?: AbortSignal;
	},
	request: typeof fetchProvenanceJson = fetchProvenanceJson
): Promise<ProducedBlendSupplyEvidence> {
	const { ledger, ledgerHash, networkId: selectedNetwork } = input.snapshot;
	if (
		selectedNetwork !== networkId ||
		!validLedger(ledger) ||
		!digestPattern.test(ledgerHash)
	)
		throw new Error('Invalid Blend evidence snapshot');
	const snapshot = { networkId, ledger, ledgerHash };
	const { accountId } = input;
	const { positions, ...poolKeys } = blendFixedSupplyKeys(accountId);

	const endpoint = new URL(input.rpcUrl);
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error('Invalid Blend evidence provider');

	const deadline = AbortSignal.timeout(8_000);
	const signal = input.signal
		? AbortSignal.any([input.signal, deadline])
		: deadline;
	async function rpc(method: RpcMethod, params?: object) {
		signal.throwIfAborted();
		const reply = record(
			await request(
				endpoint,
				{ jsonrpc: '2.0', id: method, method, params },
				{
					signal,
					maxResponseBytes:
						method === 'getNetwork' ? 16 * 1024 : 3 * 1024 * 1024
				}
			)
		);
		signal.throwIfAborted();
		if (reply.jsonrpc !== '2.0' || reply.id !== method || 'error' in reply)
			throw new Error(`Invalid Blend provider response for ${method}`);
		return record(reply.result);
	}

	const network = await rpc('getNetwork');
	if (network.passphrase !== Networks.PUBLIC)
		throw new Error('Blend provider network mismatch');

	const sharedKeys = [...Object.values(poolKeys), codeKey];
	const keys = [...sharedKeys, positions];
	const batch = await rpc('getLedgerEntries', { keys });
	if (batch.latestLedger !== ledger)
		throw new Error('Blend entry batch ledger mismatch');
	if (!Array.isArray(batch.entries) || batch.entries.length > keys.length)
		throw new Error('Invalid Blend entry batch size');

	const rows = new Map<string, { raw: RawRow; data: xdr.LedgerEntryData }>();
	for (const value of batch.entries) {
		const entry = record(value);
		const { key } = entry;
		if (typeof key !== 'string' || !keys.includes(key) || rows.has(key))
			throw new Error('Unexpected or duplicate Blend entry key');
		const raw = readRow(entry, key, ledger);
		const data = xdr.LedgerEntryData.fromXDR(raw.xdr, 'base64');
		if (data.toXDR('base64') !== raw.xdr)
			throw new Error('Noncanonical Blend entry XDR');
		verifyKey(key, data);
		rows.set(key, { raw, data });
	}

	const history = await rpc('getLedgers', {
		startLedger: ledger,
		pagination: { limit: 1 }
	});
	const headerXdr = verifyHeader(history, snapshot);

	const codeRow = rows.get(codeKey)?.raw;
	const code = codeRow
		? document({
				schema: 'blend-fixed-code-v1',
				wasmSha256,
				xdr: codeRow.xdr,
				xdrSha256: codeRow.xdrSha256
			})
		: null;
	const shared = document({
		schema: 'blend-fixed-pool-observation-v1',
		trust: 'provider_correlated',
		providerOrigin: endpoint.origin,
		providerUrlSha256: hash(endpoint.href),
		networkPassphrase: Networks.PUBLIC,
		...snapshot,
		headerXdr,
		poolId,
		wasmSha256,
		requestedKeys: sharedKeys,
		poolRows: Object.values(poolKeys).map((key) => rows.get(key)?.raw ?? null),
		codeRow:
			codeRow && code
				? {
						key: codeRow.key,
						xdrSha256: codeRow.xdrSha256,
						modifiedLedger: codeRow.modifiedLedger,
						liveUntilLedger: codeRow.liveUntilLedger,
						contentSha256: code.sha256
					}
				: null
	});
	const account = document({
		schema: 'blend-fixed-account-observation-v1',
		sharedSha256: shared.sha256,
		accountId,
		requestedKey: positions,
		row: rows.get(positions)?.raw ?? null
	});

	const entries: BlendSupplyEvidence['entries'][number][] = [];
	for (const key of [...Object.values(poolKeys), positions]) {
		const row = rows.get(key)?.raw;
		if (row && row.liveUntilLedger !== null && row.liveUntilLedger >= ledger) {
			entries.push({
				...snapshot,
				key,
				state: 'live',
				xdr: row.xdr,
				modifiedLedger: row.modifiedLedger,
				liveUntilLedger: row.liveUntilLedger
			});
		}
	}
	const instance = rows.get(poolKeys.instance)?.data;
	const instanceValue =
		instance?.type === 'contractData' ? instance.contractData.val : undefined;
	const executable =
		instanceValue?.type === 'scvContractInstance'
			? instanceValue.instance.executable
			: undefined;
	const adapterEvidence =
		executable?.type === 'contractExecutableWasm' &&
		executable.wasmHash.toString() === wasmSha256 &&
		codeRow?.liveUntilLedger != null &&
		codeRow.liveUntilLedger >= ledger &&
		entries.length === keys.length - 1
			? { rawEvidenceSha256: account.sha256, entries }
			: undefined;

	return {
		trust: 'provider_correlated',
		documents: { code, shared, account },
		adapterEvidence
	};
}

function readRow(
	entry: Record<string, unknown>,
	key: string,
	ledger: number
): RawRow {
	const { xdr: encoded, lastModifiedLedgerSeq, liveUntilLedgerSeq } = entry;
	const limit = key === codeKey ? 512 * 1024 : 32 * 1024;
	if (
		typeof encoded !== 'string' ||
		!encoded ||
		encoded.length > limit ||
		!validLedger(lastModifiedLedgerSeq) ||
		lastModifiedLedgerSeq > ledger ||
		(liveUntilLedgerSeq !== undefined &&
			liveUntilLedgerSeq !== 0 &&
			(!validLedger(liveUntilLedgerSeq) ||
				liveUntilLedgerSeq < lastModifiedLedgerSeq))
	)
		throw new Error('Invalid Blend entry content or ledger bounds');

	return {
		key,
		xdr: encoded,
		xdrSha256: hash(Buffer.from(encoded, 'base64')),
		modifiedLedger: lastModifiedLedgerSeq,
		liveUntilLedger: liveUntilLedgerSeq ?? null
	};
}

function verifyKey(key: string, entry: xdr.LedgerEntryData): void {
	if (key === codeKey) {
		if (
			entry.type !== 'contractCode' ||
			entry.contractCode.hash.toString() !== wasmSha256 ||
			hash(entry.contractCode.code) !== wasmSha256
		)
			throw new Error('Blend Wasm digest or code key mismatch');
		return;
	}
	if (entry.type !== 'contractData')
		throw new Error('Blend contract data key mismatch');
	const { contract, key: dataKey, durability } = entry.contractData;
	const actual = xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({ contract, key: dataKey, durability })
	).toXDR('base64');
	if (actual !== key) throw new Error('Blend contract data key mismatch');
}

function verifyHeader(
	history: Record<string, unknown>,
	snapshot: PositionSnapshot
): string {
	if (
		!validLedger(history.latestLedger) ||
		history.latestLedger < snapshot.ledger ||
		!Array.isArray(history.ledgers) ||
		history.ledgers.length !== 1
	)
		throw new Error('Invalid Blend provider ledger history');
	const {
		sequence,
		hash: reportedHash,
		headerXdr
	} = record(history.ledgers[0]);
	if (
		sequence !== snapshot.ledger ||
		reportedHash !== snapshot.ledgerHash ||
		typeof headerXdr !== 'string' ||
		!headerXdr ||
		headerXdr.length > 16 * 1024
	)
		throw new Error('Blend header snapshot mismatch');
	const entry = xdr.LedgerHeaderHistoryEntry.fromXDR(headerXdr, 'base64');
	if (
		entry.toXDR('base64') !== headerXdr ||
		entry.hash.toString() !== snapshot.ledgerHash ||
		entry.header.ledgerSeq !== snapshot.ledger ||
		hash(entry.header.toXDR()) !== snapshot.ledgerHash
	)
		throw new Error('Blend header digest or sequence mismatch');
	return headerXdr;
}

function validLedger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 0xffff_ffff
	);
}

function document(fields: object): EvidenceDocument {
	const json = JSON.stringify(fields);
	return { sha256: hash(json), json };
}

function hash(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
