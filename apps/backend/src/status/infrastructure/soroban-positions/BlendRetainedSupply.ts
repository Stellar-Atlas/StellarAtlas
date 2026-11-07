import { createHash } from 'node:crypto';
import { Networks, xdr } from '@stellar/stellar-sdk';
import { record } from '../http/contract-provenance/ContractBuildAttestation.js';
import {
	blendFixedSupplyKeys,
	blendFixedSupplyTarget,
	projectBlendFixedSupply,
	type BlendSupplyEvidence
} from './BlendFixedSupply.js';
import type { createBlendSupplyRefreshAdmission } from './BlendSupplyRefreshAdmission.js';
import type {
	BlendEvidenceDocuments,
	SorobanEvidenceStore
} from './SorobanEvidenceStore.js';
import type { PositionSnapshot } from './TimelockPositions.js';

const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;
const digestPattern = /^[0-9a-f]{64}$/;
const maxPending = 2;
const codeKey = xdr.LedgerKey.contractCode(
	new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmSha256, 'hex') })
).toXDR('base64');

type Selection = {
	readonly accountId: string;
	readonly snapshot: PositionSnapshot;
};
type Admission = Pick<
	ReturnType<typeof createBlendSupplyRefreshAdmission>,
	'refresh'
>;
type Store = Pick<
	SorobanEvidenceStore,
	'publishBlendEvidence' | 'readBlendEvidence'
>;
type RefreshResult =
	| Exclude<Awaited<ReturnType<Admission['refresh']>>, { status: 'completed' }>
	| { readonly status: 'retained'; readonly accountSha256: string }
	| { readonly status: 'error'; readonly reason: 'retention_error' }
	| { readonly status: 'deferred'; readonly reason: 'composition_busy' };
type ReadResult =
	| {
			readonly status: 'retained';
			readonly position: ReturnType<typeof projectBlendFixedSupply>;
	  }
	| {
			readonly status: 'unavailable';
			readonly reason: 'missing' | 'invalid' | 'snapshot_mismatch' | 'expired';
	  };

class Unavailable extends Error {
	constructor(readonly reason: 'snapshot_mismatch' | 'expired') {
		super(reason);
	}
}

/**
 * Disabled composition for one approved store and one shared provider admission.
 * A caller supplies the authorized account and authoritative expected snapshot.
 * Passive reads also require an existing account digest. There is no account
 * index, canonical tip selection, wall-clock freshness policy or RPC on read.
 */
export function createBlendRetainedSupply(admission: Admission, store: Store) {
	const pending = new Map<string, Promise<RefreshResult>>();

	function refresh(selection: Selection): Promise<RefreshResult> {
		const { accountId, snapshot } = selection;
		selectionKeys(selection);
		const key = JSON.stringify([
			accountId,
			snapshot.ledger,
			snapshot.ledgerHash
		]);
		const existing = pending.get(key);
		if (existing) return existing;
		if (pending.size >= maxPending)
			return Promise.resolve({
				status: 'deferred',
				reason: 'composition_busy'
			});

		const selected = { accountId, snapshot: { ...snapshot } };
		const operation = Promise.resolve().then(
			async (): Promise<RefreshResult> => {
				try {
					const result = await admission.refresh(selected);
					if (result.status !== 'completed') return result;
					try {
						const { documents } = result.observation;
						const accountSha256 = await store.publishBlendEvidence(documents);
						if (accountSha256 !== documents.account.sha256)
							return { status: 'error', reason: 'retention_error' };
						// The store publishes only after durable dependency order and verified reopen.
						return { status: 'retained', accountSha256 };
					} catch {
						return { status: 'error', reason: 'retention_error' };
					}
				} finally {
					pending.delete(key);
				}
			}
		);
		pending.set(key, operation);
		return operation;
	}

	return { refresh, ...createBlendRetainedSupplyReader(store) };
}

/** Passive capability for callers that do not own admission or publication. */
export function createBlendRetainedSupplyReader(
	store: Pick<SorobanEvidenceStore, 'readBlendEvidence'>
) {
	async function read(
		selection: Selection,
		accountSha256: string
	): Promise<ReadResult> {
		try {
			const { accountId, snapshot } = selection;
			const selected = { accountId, snapshot: { ...snapshot } };
			const keys = selectionKeys(selected);
			if (!digestPattern.test(accountSha256))
				return { status: 'unavailable', reason: 'invalid' };
			const documents = await store.readBlendEvidence(accountSha256);
			if (!documents) return { status: 'unavailable', reason: 'missing' };
			if (documents.account.sha256 !== accountSha256)
				return { status: 'unavailable', reason: 'invalid' };
			const evidence = projectableEvidence(selected, keys, documents);
			return {
				status: 'retained',
				position: projectBlendFixedSupply({ ...selected, evidence })
			};
		} catch (error) {
			return {
				status: 'unavailable',
				reason: error instanceof Unavailable ? error.reason : 'invalid'
			};
		}
	}

	return { read };
}

function selectionKeys({ accountId, snapshot }: Selection) {
	if (
		snapshot.networkId !== networkId ||
		!validLedger(snapshot.ledger) ||
		!digestPattern.test(snapshot.ledgerHash)
	)
		throw new Error('Invalid retained Blend selection');
	return blendFixedSupplyKeys(accountId);
}

function projectableEvidence(
	{ accountId, snapshot }: Selection,
	{ positions, ...poolKeys }: ReturnType<typeof blendFixedSupplyKeys>,
	documents: BlendEvidenceDocuments
): BlendSupplyEvidence | undefined {
	const account = record(JSON.parse(documents.account.json));
	const shared = record(JSON.parse(documents.shared.json));
	const expected = Object.values(poolKeys);
	const sharedKeys = [...expected, codeKey];
	const requestedKeys = shared.requestedKeys;
	if (
		account.schema !== 'blend-fixed-account-observation-v1' ||
		account.accountId !== accountId ||
		account.requestedKey !== positions ||
		account.sharedSha256 !== documents.shared.sha256 ||
		shared.schema !== 'blend-fixed-pool-observation-v1' ||
		shared.trust !== 'provider_correlated' ||
		shared.networkPassphrase !== Networks.PUBLIC ||
		shared.networkId !== networkId ||
		shared.poolId !== poolId ||
		shared.wasmSha256 !== wasmSha256 ||
		!Array.isArray(requestedKeys) ||
		requestedKeys.length !== sharedKeys.length ||
		!sharedKeys.every((key, index) => requestedKeys[index] === key) ||
		!Array.isArray(shared.poolRows) ||
		shared.poolRows.length !== expected.length
	)
		throw new Error('Retained Blend identity mismatch');
	if (
		shared.ledger !== snapshot.ledger ||
		shared.ledgerHash !== snapshot.ledgerHash
	)
		throw new Unavailable('snapshot_mismatch');
	verifyHeader(shared.headerXdr, snapshot);

	const codeLive = verifyCode(shared.codeRow, documents.code, snapshot.ledger);
	const rows = [...shared.poolRows, account.row];
	const entries: BlendSupplyEvidence['entries'][number][] = [];
	for (const [index, key] of [...expected, positions].entries()) {
		if (rows[index] === null) continue;
		const raw = record(rows[index]);
		const info = entryMetadata(raw, key, snapshot.ledger);
		const encoded = verifiedXdr(raw.xdr, raw.xdrSha256, 32 * 1024);
		if (info.liveUntilLedger) {
			entries.push({
				...snapshot,
				...info,
				key,
				state: 'live',
				liveUntilLedger: info.liveUntilLedger,
				xdr: encoded
			});
		}
	}
	return codeLive
		? { rawEvidenceSha256: documents.account.sha256, entries }
		: undefined;
}

function verifyCode(
	value: unknown,
	code: BlendEvidenceDocuments['code'],
	ledger: number
): boolean {
	if (value === null && code === null) return false;
	const row = record(value);
	if (!code || row.contentSha256 !== code.sha256)
		throw new Error('Retained Blend code dependency mismatch');
	const info = entryMetadata(row, codeKey, ledger);
	const document = record(JSON.parse(code.json));
	if (
		document.schema !== 'blend-fixed-code-v1' ||
		document.wasmSha256 !== wasmSha256 ||
		document.xdrSha256 !== row.xdrSha256
	)
		throw new Error('Retained Blend code identity mismatch');
	const encoded = verifiedXdr(document.xdr, document.xdrSha256, 512 * 1024);
	const entry = xdr.LedgerEntryData.fromXDR(encoded, 'base64');
	if (
		entry.toXDR('base64') !== encoded ||
		entry.type !== 'contractCode' ||
		entry.contractCode.hash.toString() !== wasmSha256 ||
		hash(entry.contractCode.code) !== wasmSha256
	)
		throw new Error('Retained Blend executable mismatch');
	return Boolean(info.liveUntilLedger);
}

function entryMetadata(
	raw: Record<string, unknown>,
	key: string,
	ledger: number
) {
	const { modifiedLedger, liveUntilLedger } = raw;
	if (
		raw.key !== key ||
		!validLedger(modifiedLedger) ||
		modifiedLedger > ledger ||
		(liveUntilLedger !== null &&
			liveUntilLedger !== 0 &&
			(!validLedger(liveUntilLedger) || liveUntilLedger < modifiedLedger))
	)
		throw new Error('Invalid retained Blend ledger metadata');
	if (liveUntilLedger && liveUntilLedger < ledger)
		throw new Unavailable('expired');
	return { modifiedLedger, liveUntilLedger };
}

function verifyHeader(encoded: unknown, snapshot: PositionSnapshot): void {
	if (typeof encoded !== 'string' || !encoded || encoded.length > 16 * 1024)
		throw new Error('Invalid retained Blend header');
	const header = xdr.LedgerHeaderHistoryEntry.fromXDR(encoded, 'base64');
	if (
		header.toXDR('base64') !== encoded ||
		header.header.ledgerSeq !== snapshot.ledger ||
		header.hash.toString() !== snapshot.ledgerHash ||
		hash(header.header.toXDR()) !== snapshot.ledgerHash
	)
		throw new Error('Retained Blend header mismatch');
}

function verifiedXdr(encoded: unknown, sha256: unknown, limit: number): string {
	if (typeof encoded !== 'string' || !encoded || encoded.length > limit)
		throw new Error('Invalid retained Blend XDR');
	const bytes = Buffer.from(encoded, 'base64');
	if (bytes.toString('base64') !== encoded || hash(bytes) !== sha256)
		throw new Error('Invalid retained Blend XDR digest');
	return encoded;
}

function hash(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function validLedger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 0xffff_ffff
	);
}
