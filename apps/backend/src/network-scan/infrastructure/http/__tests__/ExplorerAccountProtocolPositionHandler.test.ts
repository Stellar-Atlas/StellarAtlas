import { Asset, Networks, StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import type { FullHistoryLedgerView } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalLedger.js';
import {
	FullHistoryHash,
	fullHistoryLedgerSequence
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { blendFixedSupplyTarget } from '../../../../status/infrastructure/soroban-positions/BlendFixedSupply.js';
import { createGetExplorerAccountProtocolPosition } from '../../../use-cases/get-explorer-account-protocol-position/GetExplorerAccountProtocolPosition.js';
import { createExplorerAccountProtocolPositionHandler } from '../ExplorerAccountProtocolPositionHandler.js';

const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const otherAccount = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const { poolId, networkId, wasmSha256 } = blendFixedSupplyTarget;
const assetContractId = Asset.native().contractId(Networks.PUBLIC);
const snapshot = { networkId, ledger: 65000000, ledgerHash: 'a'.repeat(64) };
const accountSha256 = 'b'.repeat(64);
const closedAt = new Date('2026-11-06T03:10:41Z');
const clock = closedAt.getTime();
const route = `/v1/explorer/accounts/${accountId}/protocol-positions`;
const path = '/v1/explorer/accounts/:accountId/protocol-positions';
const sequence = fullHistoryLedgerSequence(String(snapshot.ledger));
const canonical: FullHistoryLedgerView = {
	ledgerSequence: sequence,
	closedAt,
	ledgerHash: FullHistoryHash.fromHex(snapshot.ledgerHash),
	bucketListHash: FullHistoryHash.fromHex('c'.repeat(64)),
	previousLedgerHash: FullHistoryHash.fromHex('d'.repeat(64)),
	transactionResultHash: FullHistoryHash.fromHex('e'.repeat(64)),
	transactionSetHash: FullHistoryHash.fromHex('f'.repeat(64)),
	protocolVersion: 23,
	operationCount: 1,
	transactionCount: 1
};
const selection = {
	state: 'completed',
	display: 'public_derived',
	accountId,
	poolId,
	assetId: 'native',
	reserveIndex: 0,
	wasmSha256,
	snapshot,
	ledgerClosedAt: closedAt,
	accountSha256
} as const;
const publicScope = {
	network: 'mainnet',
	accountId,
	target: { poolId, assetId: 'native', assetContractId, reserveIndex: 0 },
	coverage: 'blend_fixed_v2_1_native_xlm_supply_only',
	includedInCurrentTotals: false
};
const position = {
	adapter: 'blend-fixed-v2.1-native-xlm-supply',
	poolId,
	accountId,
	snapshot,
	status: 'observed',
	rawEvidenceSha256: accountSha256,
	wasmSha256,
	assetId: 'native',
	assetContractId,
	reserveIndex: 0,
	supplySharesRaw: '1',
	supplyShareDecimals: 7,
	underlyingEstimate: {
		kind: 'stored_rate',
		amountRaw: '1',
		decimals: 7,
		rateRaw: '1000103544200',
		rateDecimals: 12,
		rateUpdatedAtEpochSeconds: String(Math.floor(clock / 1000) - 10)
	},
	balanceScope: 'separate_protocol_supply',
	withdrawal: 'unknown'
} as const;

type Dependencies = Parameters<
	typeof createGetExplorerAccountProtocolPosition
>[0];
type Eligible = NonNullable<Awaited<ReturnType<Dependencies['lookup']>>>;
type Retained = Awaited<ReturnType<Dependencies['retained']['read']>>;

function fixture(
	options: {
		selected?: Eligible | null;
		canonical?: FullHistoryLedgerView | null;
		read?: Retained;
		now?: number;
		throws?: 'lookup' | 'canonical' | 'read';
	} = {}
) {
	const calls = { lookup: 0, canonical: 0, read: 0, upstream: 0 };
	// One server-owned record. Requests cannot change its ledger, digest or target.
	const eligible = new Map<string, Eligible | null>([
		[accountId, options.selected === undefined ? selection : options.selected]
	]);
	const retained = {
		async read(
			expected: { accountId: string; snapshot: typeof snapshot },
			digest: string
		): Promise<Retained> {
			calls.read++;
			expect(expected).toEqual({ accountId, snapshot });
			expect(digest).toBe(accountSha256);
			if (options.throws === 'read') throw new Error('private filesystem path');
			const privateFixture = {
				...position,
				provider: 'private endpoint',
				path: 'private object path'
			};
			return options.read ?? { status: 'retained', position: privateFixture };
		},
		refresh() {
			calls.upstream++;
			throw new Error('The handler must never refresh');
		}
	};
	const useCase = createGetExplorerAccountProtocolPosition({
		async lookup(id) {
			calls.lookup++;
			if (options.throws === 'lookup')
				throw new Error('private lookup failure');
			return eligible.get(id) ?? null;
		},
		canonicalLedger: {
			async findLedger(passphrase, ledger) {
				calls.canonical++;
				expect(passphrase).toBe(Networks.PUBLIC);
				expect(ledger).toBe(sequence);
				if (options.throws === 'canonical')
					throw new Error('private database error');
				return options.canonical === undefined ? canonical : options.canonical;
			}
		},
		retained,
		recentWithinMs: 60_000,
		now: () => options.now ?? clock + 5_000
	});
	const app = express().get(
		path,
		createExplorerAccountProtocolPositionHandler(useCase)
	);
	return { app, useCase, calls };
}

test('serves only derived fields from an eligible completed record and does no upstream work', async () => {
	const { app, calls } = fixture();
	const response = await request(app)
		.get(route)
		.expect(200)
		.expect('Cache-Control', 'no-store');
	expect(response.body).toEqual({
		...publicScope,
		status: 'observed',
		asOf: {
			ledger: snapshot.ledger,
			ledgerHash: snapshot.ledgerHash,
			closedAt: closedAt.toISOString(),
			ageSeconds: 5,
			freshness: 'recent'
		},
		position: {
			supplySharesRaw: '1',
			supplyShareDecimals: 7,
			underlyingEstimate: position.underlyingEstimate,
			balanceScope: 'separate_protocol_supply',
			withdrawal: 'unknown'
		}
	});
	expect(response.text).not.toContain(accountSha256);
	expect(response.text).not.toContain(wasmSha256);
	expect(calls).toEqual({ lookup: 1, canonical: 1, read: 1, upstream: 0 });
});

test.each(['digest', 'provider', 'snapshot', 'ledger', 'network'])(
	'rejects caller-supplied %s without reading anything',
	async (param) => {
		const { app, calls } = fixture();
		await request(app)
			.get(route)
			.query({ [param]: 'ignored' })
			.expect(400);
		expect(calls).toEqual({ lookup: 0, canonical: 0, read: 0, upstream: 0 });
	}
);

test('rejects a checksum-invalid account before lookup', async () => {
	const { app, calls } = fixture();
	const invalid =
		accountId.slice(0, 8) +
		(accountId[8] === 'A' ? 'B' : 'A') +
		accountId.slice(9);
	expect(StrKey.isValidEd25519PublicKey(invalid)).toBe(false);
	await request(app).get(route.replace(accountId, invalid)).expect(400);
	expect(calls.lookup).toBe(0);
});

test.each([
	['no eligible observation', null],
	['wrong account', { ...selection, accountId: otherAccount }],
	[
		'wrong network',
		{ ...selection, snapshot: { ...snapshot, networkId: 'c'.repeat(64) } }
	],
	['wrong target', { ...selection, poolId: 'another pool' }],
	['wrong executable', { ...selection, wasmSha256: 'c'.repeat(64) }],
	['invalid digest', { ...selection, accountSha256: 'invalid' }]
] as const)(
	'keeps %s unavailable before reading the local ledger or store',
	async (_name, selected) => {
		const { useCase, calls } = fixture({ selected });
		expect(await useCase.execute(accountId)).toEqual({
			...publicScope,
			status: 'unavailable',
			asOf: null
		});
		expect(calls).toEqual({ lookup: 1, canonical: 0, read: 0, upstream: 0 });
	}
);

test.each(['pending', 'private'] as const)(
	'rejects a %s lookup result that violates the eligibility contract',
	async (value) => {
		const selected = (value === 'pending'
			? { ...selection, state: value }
			: { ...selection, display: value }) as unknown as Eligible;
		const { useCase, calls } = fixture({ selected });
		expect(await useCase.execute(accountId)).toMatchObject({
			status: 'unavailable'
		});
		expect(calls.read).toBe(0);
		expect(calls.canonical).toBe(0);
	}
);

test.each([
	['missing local coverage', null],
	[
		'wrong ledger hash',
		{ ...canonical, ledgerHash: FullHistoryHash.fromHex('0'.repeat(64)) }
	],
	[
		'wrong sequence',
		{ ...canonical, ledgerSequence: fullHistoryLedgerSequence('65000001') }
	],
	['wrong close time', { ...canonical, closedAt: new Date(clock - 1000) }]
] as const)(
	'fails closed on %s without reading retained data',
	async (_name, canonical) => {
		const { app, calls } = fixture({ canonical });
		const response = await request(app).get(route).expect(503);
		expect(response.body).toEqual({
			...publicScope,
			status: 'unavailable',
			asOf: null
		});
		expect(calls).toEqual({ lookup: 1, canonical: 1, read: 0, upstream: 0 });
	}
);

test('shows old data as historical and keeps it outside current totals', async () => {
	const { useCase, calls } = fixture({ now: clock + 61_000 });
	expect(await useCase.execute(accountId)).toMatchObject({
		status: 'observed',
		includedInCurrentTotals: false,
		asOf: { freshness: 'historical', ageSeconds: 61 },
		position: {
			balanceScope: 'separate_protocol_supply',
			withdrawal: 'unknown'
		}
	});
	expect(calls.upstream).toBe(0);
});

test('refuses future ledger and rate timestamps', async () => {
	const futureLedger = fixture({ now: clock - 1 });
	expect(await futureLedger.useCase.execute(accountId)).toMatchObject({
		status: 'unavailable',
		asOf: null
	});
	expect(futureLedger.calls.canonical).toBe(0);
	const futureRate = fixture({
		read: {
			status: 'retained',
			position: {
				...position,
				underlyingEstimate: {
					...position.underlyingEstimate,
					rateUpdatedAtEpochSeconds: String(Math.floor(clock / 1000) + 1)
				}
			}
		}
	});
	expect(await futureRate.useCase.execute(accountId)).toMatchObject({
		status: 'unavailable',
		asOf: null
	});
	expect(futureRate.calls.upstream).toBe(0);
});

test('preserves observed zero and leaves missing account evidence unobserved with no amount', async () => {
	const absent = fixture({
		read: {
			status: 'retained',
			position: {
				adapter: position.adapter,
				poolId,
				accountId,
				snapshot,
				status: 'unobserved',
				reason: 'missing_evidence'
			}
		}
	});
	const result = await absent.useCase.execute(accountId);
	expect(result).toMatchObject({
		status: 'unobserved',
		asOf: { ledger: snapshot.ledger }
	});
	expect(result).not.toHaveProperty('position');
	const zero = fixture({
		read: {
			status: 'retained',
			position: {
				...position,
				supplySharesRaw: '0',
				underlyingEstimate: { ...position.underlyingEstimate, amountRaw: '0' }
			}
		}
	});
	expect(await zero.useCase.execute(accountId)).toMatchObject({
		status: 'observed',
		position: { supplySharesRaw: '0', underlyingEstimate: { amountRaw: '0' } }
	});
	expect(absent.calls.upstream + zero.calls.upstream).toBe(0);
});

test.each([
	['missing graph', { status: 'unavailable', reason: 'missing' }],
	[
		'wrong retained digest',
		{
			status: 'retained',
			position: { ...position, rawEvidenceSha256: '0'.repeat(64) }
		}
	],
	[
		'wrong retained account',
		{ status: 'retained', position: { ...position, accountId: otherAccount } }
	],
	[
		'wrong retained hash',
		{
			status: 'retained',
			position: {
				...position,
				snapshot: { ...snapshot, ledgerHash: '0'.repeat(64) }
			}
		}
	],
	[
		'wrong retained asset',
		{
			status: 'retained',
			position: { ...position, assetContractId: 'wrong asset' }
		}
	]
] as const)('never projects a balance for %s', async (_name, read) => {
	const { useCase, calls } = fixture({ read });
	expect(await useCase.execute(accountId)).toEqual({
		...publicScope,
		status: 'unavailable',
		asOf: null
	});
	expect(calls.upstream).toBe(0);
});

test.each(['lookup', 'canonical', 'read'] as const)(
	'keeps %s errors out of the public response',
	async (throws) => {
		const { app, calls } = fixture({ throws });
		const response = await request(app)
			.get(route)
			.expect(503)
			.expect('Cache-Control', 'no-store');
		expect(response.body).toEqual({
			...publicScope,
			status: 'unavailable',
			asOf: null
		});
		expect(response.text).not.toContain('private');
		expect(calls.upstream).toBe(0);
	}
);
