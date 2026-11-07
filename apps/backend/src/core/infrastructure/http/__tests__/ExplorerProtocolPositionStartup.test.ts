import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import express from 'express';
import { Container } from 'inversify';
import request from 'supertest';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import {
	FullHistoryHash,
	fullHistoryLedgerSequence
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetExplorerLocalAccountChanges } from '@network-scan/use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';
import { GetExplorerLocalTrustlineChanges } from '@network-scan/use-cases/get-explorer-local-trustline-changes/GetExplorerLocalTrustlineChanges.js';
import { GetExplorerLocalLedgers } from '@network-scan/use-cases/get-explorer-local-ledgers/GetExplorerLocalLedgers.js';
import { GetExplorerLocalReadModel } from '@network-scan/use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import { GetExplorerLocalTransactions } from '@network-scan/use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import { getConfigFromEnv } from '../../../config/Config.js';
import {
	blendFixedSupplyAdapter,
	blendFixedSupplyKeys,
	blendFixedSupplyTarget
} from '../../../../status/infrastructure/soroban-positions/BlendFixedSupply.js';
import { SorobanEvidenceStore } from '../../../../status/infrastructure/soroban-positions/SorobanEvidenceStore.js';
import {
	mountExplorerRoutes,
	prepareExplorerAccountProtocolPositionHandler
} from '../ExplorerRoutes.js';

const enabled = 'EXPLORER_ACCOUNT_PROTOCOL_POSITIONS_ENABLED';
const settings = 'EXPLORER_ACCOUNT_PROTOCOL_POSITIONS_CONFIG';
const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 19));
const unlisted = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 20));
const route = (id = accountId) =>
	`/v1/explorer/accounts/${id}/protocol-positions`;
const { networkId, poolId, wasmSha256 } = blendFixedSupplyTarget;
const ledger = 200;
const closeTime = 1_700_000_000;
const closedAt = new Date(closeTime * 1000);
const hash = (bytes: string | Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex');
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
const { positions, ...poolKeys } = blendFixedSupplyKeys(accountId);
const codeKey = xdr.LedgerKey.contractCode(
	new xdr.LedgerKeyContractCode({
		hash: Buffer.from(wasmSha256, 'hex')
	})
).toXDR('base64');
const limits = { maxObjects: 3, maxBytes: 8192, maxObjectBytes: 4096 };
const temp = resolve(tmpdir());
const prefix = 'explorer-protocol-startup-';
const originalEnv = process.env;
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(temp, prefix));
	process.env = {
		...originalEnv,
		IPSTACK_ACCESS_KEY: 'fixture',
		HORIZON_URL: 'https://horizon.example.invalid',
		NETWORK_ID: 'public',
		NETWORK_PASSPHRASE: Networks.PUBLIC,
		NETWORK_LEDGER_VERSION: '23',
		NETWORK_OVERLAY_VERSION: '35',
		NETWORK_OVERLAY_MIN_VERSION: '33',
		NETWORK_STELLAR_CORE_VERSION: 'fixture',
		NETWORK_QUORUM_SET: JSON.stringify([accountId]),
		NETWORK_KNOWN_PEERS: '[]'
	};
	delete process.env[enabled];
	delete process.env[settings];
	delete process.env.FEDERATION_SCHEDULE_DIRECTORY;
});
afterEach(async () => {
	process.env = originalEnv;
	if (
		dirname(resolve(root)) !== temp ||
		!root.slice(temp.length + 1).startsWith(prefix)
	)
		throw new Error('Unexpected protocol startup fixture root');
	await rm(root, { recursive: true, force: true });
});

function reference(accountSha256 = 'a'.repeat(64)) {
	return {
		state: 'completed',
		display: 'public_derived',
		protocol: blendFixedSupplyAdapter,
		accountId,
		poolId,
		assetId: 'native',
		reserveIndex: 0,
		wasmSha256,
		snapshot,
		ledgerClosedAt: closedAt.toISOString(),
		accountSha256
	};
}

function configure(
	value: object = {
		root,
		limits,
		recentWithinMs: 60000,
		references: [reference()]
	}
) {
	process.env[enabled] = 'true';
	process.env[settings] = JSON.stringify(value);
}

function config() {
	const result = getConfigFromEnv();
	if (result.isErr()) throw result.error;
	return result.value;
}

function kernelFixture(bindCanonical = false) {
	const container = new Container();
	const calls: { network: string; sequence: string }[] = [];
	const federationRead = jest.fn(async () => ({ status: 'unavailable' as const }));
	const unexpected = () => {
		throw new Error('Unrelated explorer use case called');
	};
	container.bind<unknown>(GetExplorerLocalTransactions).toConstantValue({
		execute: unexpected,
		findByHash: unexpected,
		findLedger: unexpected,
		findOperations: unexpected
	});
	container
		.bind<unknown>(GetExplorerLocalAccountChanges)
		.toConstantValue({ execute: federationRead });
	container
		.bind<unknown>(GetExplorerLocalTrustlineChanges)
		.toConstantValue({ execute: unexpected });
	container
		.bind<unknown>(GetExplorerLocalLedgers)
		.toConstantValue({ execute: unexpected });
	container
		.bind<unknown>(GetExplorerLocalReadModel)
		.toConstantValue({ execute: unexpected });
	if (bindCanonical)
		container
			.bind(HISTORY_TYPES.FullHistoryCanonicalRepository)
			.toConstantValue({
				async findLedger(network: string, sequence: string) {
					calls.push({ network, sequence });
					return {
						ledgerSequence: fullHistoryLedgerSequence(String(ledger)),
						ledgerHash: FullHistoryHash.fromHex(ledgerHash),
						closedAt
					};
				}
			});
	return { kernel: { container }, calls, federationRead };
}

async function start(bindCanonical = false) {
	const cfg = config();
	const { kernel, calls } = kernelFixture(bindCanonical);
	const handler = await prepareExplorerAccountProtocolPositionHandler(
		kernel,
		cfg
	);
	const app = express();
	mountExplorerRoutes(app, kernel, cfg, handler);
	return { app, calls };
}

function doc(value: object) {
	const json = JSON.stringify(value);
	return { json, sha256: hash(json) };
}

test.each([false, true])(
	'federation uses its explicit directory opt-in with background work disabled, configured=%s',
	async (configured) => {
		process.env.API_BACKGROUND_TASKS_ENABLED = 'false';
		if (configured) process.env.FEDERATION_SCHEDULE_DIRECTORY = root;
		const { kernel, federationRead } = kernelFixture();
		const app = express();
		const mount = mountExplorerRoutes(app, kernel, config(), undefined, false);
		if (configured && process.platform === 'win32') {
			await expect(mount).rejects.toThrow('requires directory sync support');
			return;
		}
		const drain = await mount;
		await request(app)
			.get('/v1/explorer/accounts/' + accountId + '/federation')
			.expect('Cache-Control', 'no-store')
			.expect(503)
			.expect({ status: 'temporary_failure', accountId, network: 'mainnet' });
		expect(federationRead).toHaveBeenCalledTimes(configured ? 1 : 0);
		await expect(drain()).resolves.toBe(true);
	}
);

test('rejects an unsafe federation directory even with background work disabled', async () => {
	process.env.API_BACKGROUND_TASKS_ENABLED = 'false';
	process.env.FEDERATION_SCHEDULE_DIRECTORY = 'relative-schedule';
	const { kernel, federationRead } = kernelFixture();
	await expect(mountExplorerRoutes(express(), kernel, config(), undefined, false))
		.rejects.toThrow('must be absolute');
	expect(federationRead).not.toHaveBeenCalled();
});

test.each([undefined, 'false'])(
	'normal startup leaves the route off with switch %s',
	async (value) => {
		if (value !== undefined) process.env[enabled] = value;
		process.env[settings] = '{not opened when off';
		const { app, calls } = await start();
		await request(app).get(route()).expect(404);
		expect(calls).toEqual([]);
	}
);

test.each([
	['relative root', () => ({ root: 'relative' }), /absolute private root/],
	[
		'missing age policy',
		() => ({ recentWithinMs: undefined }),
		/recent window/
	],
	['unbounded age', () => ({ recentWithinMs: 86_400_001 }), /recent window/],
	[
		'unbounded bytes',
		() => ({ limits: { ...limits, maxBytes: 1_000_000_000 } }),
		/retention limits/
	],
	[
		'unbounded objects',
		() => ({ limits: { ...limits, maxObjects: 49 } }),
		/retention limits/
	],
	[
		'unbounded object bytes',
		() => ({ limits: { ...limits, maxObjectBytes: 9000 } }),
		/retention limits/
	],
	[
		'empty references',
		() => ({ references: [] }),
		/completed public references/
	],
	[
		'private reference',
		() => ({ references: [{ ...reference(), display: 'private' }] }),
		/completed public references/
	],
	[
		'pending reference',
		() => ({ references: [{ ...reference(), state: 'pending' }] }),
		/completed public references/
	],
	[
		'duplicate references',
		() => ({ references: [reference(), reference()] }),
		/completed public references/
	],
	[
		'invalid account',
		() => ({ references: [{ ...reference(), accountId: 'invalid' }] }),
		/completed public references/
	],
	[
		'wrong protocol',
		() => ({ references: [{ ...reference(), protocol: 'another' }] }),
		/completed public references/
	],
	[
		'unknown reference field',
		() => ({ references: [{ ...reference(), provider: 'private value' }] }),
		/completed public references/
	],
	[
		'unknown configuration field',
		() => ({ extra: 'private value' }),
		/configuration fields/
	]
] as const)('rejects enabled configuration with %s', (_name, change, error) => {
	configure({
		root,
		limits,
		recentWithinMs: 60000,
		references: [reference()],
		...change()
	});
	expect(config).toThrow(error);
});

test('rejects malformed switch, oversized or invalid JSON and other network on the real config loader', () => {
	process.env[enabled] = '1';
	expect(config).toThrow('must be true or false');
	process.env[enabled] = 'true';
	process.env[settings] = ' '.repeat(16 * 1024 + 1);
	expect(config).toThrow('at most 16 KiB');
	process.env[settings] = '{invalid';
	expect(config).toThrow('configuration JSON');
	configure();
	process.env.NETWORK_PASSPHRASE = Networks.TESTNET;
	expect(config).toThrow('require Stellar Mainnet');
});

test('fails startup when the enabled private root is unavailable', async () => {
	configure({
		root: join(root, 'absent'),
		limits,
		recentWithinMs: 60000,
		references: [reference()]
	});
	await expect(start()).rejects.toThrow('private store is unavailable');
});

test('normal startup mounts only the approved passive route and uses the existing retained store', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
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
	const retained = await store.publishBlendEvidence({
		code: null,
		shared,
		account
	});
	configure({
		root,
		limits,
		recentWithinMs: 60000,
		references: [reference(retained)]
	});
	const { app, calls } = await start(true);
	const response = await request(app)
		.get(route())
		.expect(200)
		.expect('Cache-Control', 'no-store');
	expect(response.body).toMatchObject({
		accountId,
		status: 'unobserved',
		asOf: { ledger, ledgerHash, freshness: 'historical' },
		includedInCurrentTotals: false
	});
	expect(response.body).not.toHaveProperty('position');
	expect(response.text).not.toContain(retained);
	await request(app).get(route(unlisted)).expect(503);
	await request(app).get(route()).query({ digest: retained }).expect(400);
	expect(calls).toEqual([
		{ network: Networks.PUBLIC, sequence: String(ledger) }
	]);
});
