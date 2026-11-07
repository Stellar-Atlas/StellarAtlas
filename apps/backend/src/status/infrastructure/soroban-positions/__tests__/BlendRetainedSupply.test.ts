import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import type { fetchProvenanceJson } from '../../http/contract-provenance/BoundedProvenanceJson.js';
import {
	blendFixedSupplyKeys,
	blendFixedSupplyTarget
} from '../BlendFixedSupply.js';
import { createBlendRetainedSupply } from '../BlendRetainedSupply.js';
import { createBlendSupplyRefreshAdmission } from '../BlendSupplyRefreshAdmission.js';
import { SorobanEvidenceStore } from '../SorobanEvidenceStore.js';

const digest = (bytes: Uint8Array | string) =>
	createHash('sha256').update(bytes).digest('hex');
const ledger = 200;
const zero = Buffer.alloc(32);
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
	baseFee: 100,
	baseReserve: 5_000_000,
	maxTxSetSize: 1000,
	skipList: [zero, zero, zero, zero],
	ext: xdr.LedgerHeaderExt.v0()
});
const ledgerHash = digest(header.toXDR());
const headerXdr = new xdr.LedgerHeaderHistoryEntry({
	header,
	hash: Buffer.from(ledgerHash, 'hex'),
	ext: xdr.LedgerHeaderHistoryEntryExt.v0()
}).toXDR('base64');
const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const otherAccount = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const snapshot = {
	networkId: blendFixedSupplyTarget.networkId,
	ledger,
	ledgerHash
};
const selected = { accountId, snapshot };
const limits = { maxBytes: 8192, maxObjectBytes: 4096, maxObjects: 8 };
const temp = resolve(tmpdir());
const prefix = 'blend-retained-supply-';
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(temp, prefix));
});
afterEach(async () => {
	if (
		dirname(resolve(root)) !== temp ||
		!root.slice(temp.length + 1).startsWith(prefix)
	)
		throw new Error('Unexpected retained Blend test root');
	await rm(root, { recursive: true, force: true });
});

function setup(entries: readonly unknown[] = []) {
	const calls: string[] = [];
	const results = {
		getNetwork: { passphrase: Networks.PUBLIC },
		getLedgerEntries: { latestLedger: ledger, entries },
		getLedgers: {
			latestLedger: ledger,
			ledgers: [{ sequence: ledger, hash: ledgerHash, headerXdr }]
		}
	};
	const request: typeof fetchProvenanceJson = async (_url, body) => {
		const { method, id } = body as { method: keyof typeof results; id: string };
		calls.push(method);
		return { jsonrpc: '2.0', id, result: results[method] };
	};
	return {
		admission: createBlendSupplyRefreshAdmission('https://rpc.example.test', {
			request
		}),
		calls
	};
}

function makeDocument(data: object) {
	const json = JSON.stringify(data);
	return { json, sha256: digest(json) };
}

function retainedRef(
	result: Awaited<
		ReturnType<ReturnType<typeof createBlendRetainedSupply>['refresh']>
	>
) {
	if (result.status !== 'retained')
		throw new Error('Expected retained reference');
	return result.accountSha256;
}

test('joins equivalent refreshes through store publication and keeps reads provider-free', async () => {
	const { admission, calls } = setup();
	const store = await SorobanEvidenceStore.open(root, limits);
	let unblock!: () => void;
	let entered!: () => void;
	const wait = new Promise<void>((resolve) => {
		unblock = resolve;
	});
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let writes = 0;
	const service = createBlendRetainedSupply(admission, {
		readBlendEvidence: (sha256) => store.readBlendEvidence(sha256),
		async publishBlendEvidence(documents) {
			writes++;
			entered();
			await wait;
			return store.publishBlendEvidence(documents);
		}
	});
	expect(await service.read(selected, 'a'.repeat(64))).toEqual({
		status: 'unavailable',
		reason: 'missing'
	});
	expect(calls).toEqual([]);
	const first = service.refresh(selected);
	await writing;
	const second = service.refresh({ accountId, snapshot: { ...snapshot } });
	expect(second).toBe(first);
	expect(await readdir(root)).toEqual([]);
	unblock();
	const sha256 = retainedRef(await second);
	expect(writes).toBe(1);
	expect(calls).toEqual(['getNetwork', 'getLedgerEntries', 'getLedgers']);
	expect(await service.read(selected, sha256)).toMatchObject({
		status: 'retained',
		position: { status: 'unobserved', reason: 'missing_evidence' }
	});
	expect(calls).toHaveLength(3);
});

test('never returns a reference on capacity failure and can publish the admitted result on explicit retry', async () => {
	const { admission, calls } = setup();
	const limited = await SorobanEvidenceStore.open(root, {
		...limits,
		maxObjects: 1
	});
	const service = createBlendRetainedSupply(admission, limited);
	expect(await service.refresh(selected)).toEqual({
		status: 'error',
		reason: 'retention_error'
	});
	expect(await readdir(root)).toEqual([]);
	const healthy = await SorobanEvidenceStore.open(root, limits);
	const retried = createBlendRetainedSupply(admission, healthy);
	expect(await retried.refresh(selected)).toMatchObject({ status: 'retained' });
	expect(calls).toHaveLength(3);
});

test('rejects reference loss, changed account, network or selected snapshot without refreshing', async () => {
	const { admission, calls } = setup();
	const store = await SorobanEvidenceStore.open(root, limits);
	const service = createBlendRetainedSupply(admission, store);
	const sha256 = retainedRef(await service.refresh(selected));
	expect(
		await service.read({ ...selected, accountId: otherAccount }, sha256)
	).toEqual({
		status: 'unavailable',
		reason: 'invalid'
	});
	expect(
		await service.read(
			{ ...selected, snapshot: { ...snapshot, networkId: 'b'.repeat(64) } },
			sha256
		)
	).toEqual({
		status: 'unavailable',
		reason: 'invalid'
	});
	for (const mismatch of [
		{ ...snapshot, ledger: ledger + 1 },
		{ ...snapshot, ledgerHash: 'c'.repeat(64) }
	]) {
		expect(
			await service.read({ ...selected, snapshot: mismatch }, sha256)
		).toEqual({
			status: 'unavailable',
			reason: 'snapshot_mismatch'
		});
	}
	const graph = await store.readBlendEvidence(sha256);
	await unlink(join(root, graph!.shared.sha256));
	expect(await service.read(selected, sha256)).toEqual({
		status: 'unavailable',
		reason: 'missing'
	});
	expect(calls).toHaveLength(3);
});

test.each([
	['wrong pool', { poolId: 'other pool' }],
	['wrong network passphrase', { networkPassphrase: Networks.TESTNET }],
	['wrong Wasm digest', { wasmSha256: 'b'.repeat(64) }],
	['wrong reserve scope', { requestedKeys: ['other reserve key'] }],
	['tampered header', { headerXdr: 'AAAA' }]
] as const)('rejects verified content with %s', async (_name, mutation) => {
	const { admission, calls } = setup();
	const store = await SorobanEvidenceStore.open(root, limits);
	const service = createBlendRetainedSupply(admission, store);
	const sha256 = retainedRef(await service.refresh(selected));
	const graph = (await store.readBlendEvidence(sha256))!;
	const shared = makeDocument({
		...JSON.parse(graph.shared.json),
		...mutation
	});
	const account = makeDocument({
		...JSON.parse(graph.account.json),
		sharedSha256: shared.sha256
	});
	const changed = await store.publishBlendEvidence({
		...graph,
		shared,
		account
	});
	expect(await service.read(selected, changed)).toEqual({
		status: 'unavailable',
		reason: 'invalid'
	});
	expect(calls).toHaveLength(3);
});

test('keeps a retained expired account row unavailable and never projects it as zero', async () => {
	const { positions } = blendFixedSupplyKeys(accountId);
	const { contract, key, durability } = xdr.LedgerKey.fromXDR(
		positions,
		'base64'
	).contractData;
	const encoded = xdr.LedgerEntryData.contractData(
		new xdr.ContractDataEntry({
			contract,
			key,
			durability,
			ext: xdr.ExtensionPoint.v0(),
			val: xdr.ScVal.scvVoid()
		})
	).toXDR('base64');
	const { admission, calls } = setup([
		{
			key: positions,
			xdr: encoded,
			lastModifiedLedgerSeq: ledger - 2,
			liveUntilLedgerSeq: ledger - 1
		}
	]);
	const store = await SorobanEvidenceStore.open(root, limits);
	const service = createBlendRetainedSupply(admission, store);
	const sha256 = retainedRef(await service.refresh(selected));
	expect(await service.read(selected, sha256)).toEqual({
		status: 'unavailable',
		reason: 'expired'
	});
	expect(calls).toHaveLength(3);
});
