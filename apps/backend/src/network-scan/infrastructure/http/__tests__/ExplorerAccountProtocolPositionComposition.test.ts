import { createHash } from 'node:crypto';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import {
	FullHistoryHash,
	fullHistoryLedgerSequence
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	blendFixedSupplyAdapter,
	blendFixedSupplyKeys,
	blendFixedSupplyTarget
} from '../../../../status/infrastructure/soroban-positions/BlendFixedSupply.js';
import { SorobanEvidenceStore } from '../../../../status/infrastructure/soroban-positions/SorobanEvidenceStore.js';
import { composeExplorerAccountProtocolPositionHandler } from '../ExplorerAccountProtocolPositionComposition.js';

const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 15));
const otherAccount = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 16));
const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;
const ledger = 200;
const closeTime = 1_700_000_000;
const closedAt = new Date(closeTime * 1000);
const hash = (value: string | Uint8Array) =>
	createHash('sha256').update(value).digest('hex');
const zero = Buffer.alloc(32);
const header = new xdr.LedgerHeader({
	ledgerVersion: 23,
	previousLedgerHash: zero,
	scpValue: new xdr.StellarValue({
		txSetHash: zero,
		closeTime: BigInt(closeTime),
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
const ledgerHash = hash(header.toXDR());
const headerXdr = new xdr.LedgerHeaderHistoryEntry({
	header,
	hash: Buffer.from(ledgerHash, 'hex'),
	ext: xdr.LedgerHeaderHistoryEntryExt.v0()
}).toXDR('base64');
const snapshot = { networkId, ledger, ledgerHash };
const zeroHash = FullHistoryHash.fromBytes(zero);
const canonical = {
	ledgerSequence: fullHistoryLedgerSequence(String(ledger)),
	closedAt,
	ledgerHash: FullHistoryHash.fromHex(ledgerHash),
	bucketListHash: zeroHash,
	previousLedgerHash: zeroHash,
	transactionResultHash: zeroHash,
	transactionSetHash: zeroHash,
	protocolVersion: 23,
	operationCount: 0,
	transactionCount: 0
};
const { positions, ...poolKeys } = blendFixedSupplyKeys(accountId);
const codeKey = xdr.LedgerKey.contractCode(
	new xdr.LedgerKeyContractCode({
		hash: Buffer.from(wasmSha256, 'hex')
	})
).toXDR('base64');
const temp = resolve(tmpdir());
const prefix = 'eligible-blend-reference-';
const route = (id = accountId) =>
	`/v1/explorer/accounts/${id}/protocol-positions`;
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(temp, prefix));
});
afterEach(async () => {
	if (
		dirname(resolve(root)) !== temp ||
		!root.slice(temp.length + 1).startsWith(prefix)
	)
		throw new Error('Unexpected eligible reference fixture root');
	await rm(root, { recursive: true, force: true });
});

function doc(value: object) {
	const json = JSON.stringify(value);
	return { json, sha256: hash(json) };
}

async function retainedFixture() {
	const store = await SorobanEvidenceStore.open(root, {
		maxObjects: 3,
		maxBytes: 8192,
		maxObjectBytes: 4096
	});
	const shared = doc({
		schema: 'blend-fixed-pool-observation-v1',
		trust: 'provider_correlated',
		networkPassphrase: Networks.PUBLIC,
		...snapshot,
		headerXdr,
		poolId,
		wasmSha256,
		requestedKeys: [...Object.values(poolKeys), codeKey],
		poolRows: [null, null, null, null],
		codeRow: null
	});
	const account = doc({
		schema: 'blend-fixed-account-observation-v1',
		sharedSha256: shared.sha256,
		accountId,
		requestedKey: positions,
		row: null
	});
	const accountSha256 = await store.publishBlendEvidence({
		code: null,
		shared,
		account
	});
	return {
		store,
		shared,
		reference: {
			state: 'completed',
			display: 'public_derived',
			protocol: blendFixedSupplyAdapter,
			accountId,
			poolId,
			assetId: 'native',
			reserveIndex: 0,
			wasmSha256,
			snapshot: { ...snapshot },
			ledgerClosedAt: closedAt.toISOString(),
			accountSha256
		}
	};
}

function mount(
	store: SorobanEvidenceStore,
	references: readonly unknown[],
	ledgerView: typeof canonical | null = canonical,
	ageSeconds = 5
) {
	const calls = { canonical: 0, store: 0, upstream: 0 };
	const passive = {
		readBlendEvidence(digest: string) {
			calls.store++;
			return store.readBlendEvidence(digest);
		},
		refresh() {
			calls.upstream++;
			throw new Error('Read must never refresh');
		}
	};
	const handler = composeExplorerAccountProtocolPositionHandler({
		references,
		store: passive,
		canonicalLedger: {
			async findLedger(network, sequence) {
				calls.canonical++;
				expect(network).toBe(Networks.PUBLIC);
				expect(sequence).toBe(canonical.ledgerSequence);
				return ledgerView;
			}
		},
		recentWithinMs: 60_000,
		now: () => closedAt.getTime() + ageSeconds * 1000
	});
	return {
		calls,
		app: express().get(
			'/v1/explorer/accounts/:accountId/protocol-positions',
			handler
		)
	};
}

test('reads a server-approved retained graph and exposes unobserved without upstream work', async () => {
	const { store, reference } = await retainedFixture();
	const { calls, app } = mount(store, [reference]);
	const response = await request(app)
		.get(route())
		.expect(200)
		.expect('Cache-Control', 'no-store');
	expect(response.body).toMatchObject({
		accountId,
		status: 'unobserved',
		includedInCurrentTotals: false,
		asOf: {
			ledger,
			ledgerHash,
			closedAt: closedAt.toISOString(),
			freshness: 'recent',
			ageSeconds: 5
		}
	});
	expect(response.body).not.toHaveProperty('position');
	expect(response.text).not.toContain(reference.accountSha256);
	expect(calls).toEqual({ canonical: 1, store: 1, upstream: 0 });
});

test.each([
	{ state: 'pending' },
	{ display: 'private' },
	{ protocol: 'unregistered' },
	{ assetId: 'another asset' },
	{ reserveIndex: 1 },
	{ accountSha256: undefined },
	{ ledgerClosedAt: '2023-11-14' },
	{ snapshot: { ...snapshot, networkId: 'a'.repeat(64) } }
])(
	'rejects incomplete, private or mismatched server selections %#',
	async (override) => {
		const { store, reference } = await retainedFixture();
		const { calls, app } = mount(store, [{ ...reference, ...override }]);
		await request(app).get(route()).expect(503);
		expect(calls).toEqual({ canonical: 0, store: 0, upstream: 0 });
	}
);

test('rejects an ambiguous account even when one duplicate is private', async () => {
	const { store, reference } = await retainedFixture();
	const { calls, app } = mount(store, [
		reference,
		{ ...reference, display: 'private' }
	]);
	await request(app).get(route()).expect(503);
	expect(calls).toEqual({ canonical: 0, store: 0, upstream: 0 });
});

test('copies selected identity and snapshot rather than retaining caller-mutable references', async () => {
	const { store, reference } = await retainedFixture();
	const { calls, app } = mount(store, [reference]);
	reference.accountId = otherAccount;
	reference.snapshot.ledgerHash = 'b'.repeat(64);
	await request(app).get(route()).expect(200);
	await request(app).get(route(otherAccount)).expect(503);
	expect(calls).toEqual({ canonical: 1, store: 1, upstream: 0 });
});

test('refuses an oversized manifest and leaves unlisted accounts unavailable', async () => {
	const { store, reference } = await retainedFixture();
	expect(() =>
		mount(
			store,
			Array.from({ length: 17 }, () => reference)
		)
	).toThrow('reference list size');
	const { calls, app } = mount(store, []);
	await request(app).get(route()).expect(503);
	expect(calls).toEqual({ canonical: 0, store: 0, upstream: 0 });
});

test('does not authorize a retained digest for a different account', async () => {
	const { store, reference } = await retainedFixture();
	const { calls, app } = mount(store, [
		{ ...reference, accountId: otherAccount }
	]);
	await request(app).get(route(otherAccount)).expect(503);
	expect(calls).toEqual({ canonical: 1, store: 1, upstream: 0 });
});

test('checks canonical scope before opening the store and refuses missing dependencies', async () => {
	const { store, reference, shared } = await retainedFixture();
	const noCoverage = mount(store, [reference], null);
	await request(noCoverage.app).get(route()).expect(503);
	expect(noCoverage.calls.store).toBe(0);
	const wrongFork = mount(store, [reference], {
		...canonical,
		ledgerHash: zeroHash
	});
	await request(wrongFork.app).get(route()).expect(503);
	expect(wrongFork.calls.store).toBe(0);
	await unlink(join(root, shared.sha256));
	const incomplete = mount(store, [reference]);
	await request(incomplete.app).get(route()).expect(503);
	expect(incomplete.calls).toEqual({ canonical: 1, store: 1, upstream: 0 });
});

test('labels historical coverage and rejects future coverage through the composed handler', async () => {
	const { store, reference } = await retainedFixture();
	const old = mount(store, [reference], canonical, 61);
	const response = await request(old.app).get(route()).expect(200);
	expect(response.body).toMatchObject({
		asOf: { freshness: 'historical' },
		includedInCurrentTotals: false
	});
	const future = mount(store, [reference], canonical, -1);
	await request(future.app).get(route()).expect(503);
	expect(future.calls).toEqual({ canonical: 0, store: 0, upstream: 0 });
});
