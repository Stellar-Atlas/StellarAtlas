import { Networks } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	accountBatchIdV8,
	accountId,
	accountObservationRow
} from '../../../../../network-scan/use-cases/get-explorer-local-account-changes/__tests__/ExplorerLocalAccountChangeTestFixture.js';
import {
	mapExplorerLocalAccountChange,
	mapExplorerLocalAccountLatestCoverage
} from '../../../../../network-scan/use-cases/get-explorer-local-account-changes/ExplorerLocalAccountChangeMapper.js';
import {
	AccountFederationService,
	accountFederationRouter,
	createAccountFederation
} from '../AccountFederationRouter.js';
import { ScheduledFederationProviderBudget } from '../FederationProviderBudget.js';
import { SharedFederationScheduleStore } from '../SharedFederationScheduleStore.js';
import { fixtureDirectorySync } from './scheduleFixture.js';

const now = () => Date.parse('2026-07-15T12:05:00.000Z');
const path = '/v1/explorer/accounts/' + accountId + '/federation';
const display = {
	status: 'display_only',
	accountId,
	stellarAddress: 'example*alias.example',
	memo: { type: 'id', value: '18446744073709551615' },
	homeDomain: 'example.org',
	aliasDomain: 'alias.example',
	reverseProviderOrigin: 'https://provider.example',
	forwardProviderOrigin: 'https://alias-provider.example'
} as const;
type DisplayResult = Omit<typeof display, 'memo'> & {
	readonly memo: { readonly type: 'id' | 'text'; readonly value: string };
};
const indexed = (
	overrides: Parameters<typeof accountObservationRow>[0] = {}
) => {
	const row = accountObservationRow({
		latestBatchId: accountBatchIdV8,
		latestFirstLedger: '63390016',
		latestLastLedger: '63390079',
		latestLedgerClosedAt: new Date('2026-07-15T12:01:00Z'),
		...overrides
	});
	return {
		status: 'available',
		accountId,
		generatedAt: new Date(now()).toISOString(),
		interpretation: 'historical_observations_not_current_state',
		limit: 1,
		count: 1,
		truncated: false,
		source: 'postgres_proof_gated_lcm_account_changes',
		coverage: mapExplorerLocalAccountLatestCoverage(row),
		records: [mapExplorerLocalAccountChange(row, accountId)]
	} as const;
};

function fixture(result = indexed()) {
	const readAccount = jest.fn(async () => result);
	const lookup = jest.fn<
		Promise<DisplayResult | { status: 'throttled'; retryAtMs: number }>,
		[string, string | null]
	>(async () => display);
	const service = new AccountFederationService(
		readAccount,
		lookup,
		async () => undefined,
		now
	);
	const app = express();
	app.use('/v1/explorer', accountFederationRouter('mainnet', service));
	return { app, readAccount, lookup };
}

it('uses the indexed domain, returns exact display-only data and sets no-store', async () => {
	const { app, readAccount, lookup } = fixture();
	const result = await request(app)
		.get(path)
		.expect('Cache-Control', 'no-store')
		.expect('X-Content-Type-Options', 'nosniff')
		.expect(200);
	expect(readAccount).toHaveBeenCalledWith({ accountId, limit: 1 });
	expect(lookup).toHaveBeenCalledWith(accountId, 'example.org');
	expect(result.body).toEqual({
		...display,
		network: 'mainnet',
		observedLedger: '63390042'
	});
	expect(result.headers.etag).toBeUndefined();
});

it('encodes provider markup safely without changing parsed JSON or caching it', async () => {
	const { app, lookup } = fixture();
	const memo = { type: 'text', value: '</script><svg onload="alert(1)">&' } as const;
	// Keep the fixture independent from the provider parser.
	lookup.mockImplementationOnce(async () => ({ ...display, memo }));
	const result = await request(app)
		.get(path)
		.set('If-None-Match', '*')
		.expect('Content-Type', /application\/json/)
		.expect('Cache-Control', 'no-store')
		.expect('X-Content-Type-Options', 'nosniff')
		.expect(200);
	expect(result.text).toContain('\\u003c/script\\u003e');
	expect(result.text).toContain('\\u0026');
	expect(result.text).not.toContain('<svg');
	expect(result.body.memo).toEqual(memo);
	expect(result.headers.etag).toBeUndefined();
});

it('rejects caller-supplied network, domain and endpoint and skips HEAD', async () => {
	const { app, readAccount, lookup } = fixture();
	for (const query of [
		'network=testnet',
		'domain=example.org',
		'endpoint=https://provider.example'
	])
		await request(app)
			.get(path + '?' + query)
			.expect('Cache-Control', 'no-store')
			.expect(400);
	await request(app).head(path).expect('Cache-Control', 'no-store').expect(405);
	await request(app)
		.get('/v1/explorer/accounts/Ginvalid/federation')
		.expect(400);
	const malicious = await request(app)
		.get('/v1/explorer/accounts/' + encodeURIComponent('<script>alert(1)</script>') + '/federation')
		.expect('Content-Type', /application\/json/)
		.expect('Cache-Control', 'no-store')
		.expect('X-Content-Type-Options', 'nosniff')
		.expect(400)
		.expect({ error: 'invalid_account_or_query' });
	expect(malicious.headers.etag).toBeUndefined();
	expect(readAccount).not.toHaveBeenCalled();
	expect(lookup).not.toHaveBeenCalled();
});

it.each([
	[
		{ deleted: true, changeType: 2, changeTypeString: 'removed' },
		'unsupported'
	],
	[{ homeDomain: '' }, 'unsupported'],
	[
		{ latestLedgerClosedAt: new Date('2026-07-15T11:00:00Z') },
		'indexed_evidence_insufficient'
	],
	[
		{ latestBatchId: '00000000-0000-8000-8000-000000000009' },
		'indexed_evidence_insufficient'
	],
	[
		{
			observationLedgerClosedAt: new Date('2026-07-15T11:00:00Z'),
			closedAtUnixMillis: String(Date.parse('2026-07-15T11:00:00Z'))
		},
		'indexed_evidence_insufficient'
	]
] as const)(
	'skips federation when the latest indexed evidence is ineligible %#',
	async (overrides, status) => {
		const { app, lookup } = fixture(indexed(overrides));
		const result = await request(app)
			.get(path)
			.expect('Cache-Control', 'no-store')
			.expect(200);
		expect(result.body).toEqual({
			status,
			accountId,
			network: 'mainnet'
		});
		expect(lookup).not.toHaveBeenCalled();
	}
);

it('reports throttling with a Retry-After header and disables lookup without configured ownership', async () => {
	const { app, lookup } = fixture();
	const retryAtMs = Date.now() + 90_000;
	lookup.mockResolvedValueOnce({ status: 'throttled', retryAtMs });
	const result = await request(app)
		.get(path)
		.expect('Cache-Control', 'no-store')
		.expect(429);
	expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
	expect(result.body).toEqual({
		status: 'throttled',
		accountId,
		network: 'mainnet',
		retryAtMs
	});
	const disabledRead = jest.fn(async () => indexed());
	const disabled = await createAccountFederation(
		undefined,
		Networks.TESTNET,
		disabledRead
	);
	const disabledApp = express();
	disabledApp.use('/v1/explorer', disabled.router);
	await request(disabledApp)
		.get(path)
		.expect('Cache-Control', 'no-store')
		.expect(503)
		.expect({ status: 'temporary_failure', accountId, network: 'testnet' });
	expect(disabledRead).not.toHaveBeenCalled();
	await expect(disabled.drain()).resolves.toBe(true);
});

it('accepts only configured local ownership and uses its server-selected network', async () => {
	const read = jest.fn(async () => indexed({ homeDomain: '' }));
	await expect(
		createAccountFederation('relative-schedule', Networks.PUBLIC, read)
	).rejects.toThrow('must be absolute');
	const directory = await mkdtemp(join(tmpdir(), 'atlas-federation-owner-'));
	const clock = jest.spyOn(Date, 'now').mockImplementation(now);
	try {
		if (process.platform === 'win32') {
			await expect(
				createAccountFederation(directory, Networks.TESTNET, read)
			).rejects.toThrow('requires directory sync support');
			expect(read).not.toHaveBeenCalled();
			return;
		}
		const federation = await createAccountFederation(
			directory,
			Networks.TESTNET,
			read
		);
		const app = express();
		app.use('/v1/explorer', federation.router);
		await request(app)
			.get(path)
			.expect('Cache-Control', 'no-store')
			.expect(200)
			.expect({ status: 'unsupported', accountId, network: 'testnet' });
		expect(read).toHaveBeenCalledTimes(1);
		await expect(federation.drain()).resolves.toBe(true);
	} finally {
		clock.mockRestore();
		await rmdir(directory);
	}
});

it('bounds graceful drain, reports unresolved ownership, and lets the lock owner finish', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'atlas-federation-drain-'));
	const lock = join(directory, 'federation-schedule.lock');
	const state = join(directory, 'federation-schedule.json');
	const store = new SharedFederationScheduleStore(
		directory,
		fixtureDirectorySync
	);
	const budget = new ScheduledFederationProviderBudget(store, () => 10_000);
	const lookup = jest.fn(async () => {
		await budget.run('provider.example', async () => {
			await writeFile(lock, 'held by fixture owner', { flag: 'wx', mode: 0o600 });
			started();
			return { status: 200, headers: {}, body: Buffer.alloc(0) };
		});
		return display;
	});
	let started!: () => void;
	const held = new Promise<void>((resolve) => {
		started = resolve;
	});
	const service = new AccountFederationService(
		async () => indexed(),
		lookup,
		() => store.drain(),
		now
	);
	const active = service.resolve(accountId);
	try {
		await held;
		await expect(service.drain(20)).resolves.toBe(false);
		await expect(service.resolve(accountId)).resolves.toEqual({
			status: 'temporary_failure'
		});
		expect(await readFile(lock, 'utf8')).toBe('held by fixture owner');
		expect(JSON.parse(await readFile(state, 'utf8'))).toEqual([
			['provider.example', 70_000, 1, 1, 0, 0]
		]);
	} finally {
		await unlink(lock);
		await active;
	}
	await expect(service.drain()).resolves.toBe(true);
	expect(lookup).toHaveBeenCalledTimes(1);
	expect(JSON.parse(await readFile(state, 'utf8'))).toEqual([
		['provider.example', 70_000, 1, 0, 0, 0]
	]);
	await unlink(state);
	await rmdir(directory);
});
