import { jest } from '@jest/globals';
import { Networks } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import {
	createExplorerAccountProvider,
	ExplorerAccountProviderError
} from '../../../../../network-scan/infrastructure/http/ExplorerAccountProvider.js';
import {
	fetchExplorerAccount,
	type ExplorerAccountDTO
} from '../../../../../network-scan/infrastructure/http/ExplorerAccountClient.js';
import { HorizonAccountReadError } from '../../../../../network-scan/infrastructure/http/HorizonAccountResponse.js';
import {
	buildTestApp,
	canonicalSourceAccount as accountId
} from '../../../../../network-scan/infrastructure/http/__tests__/BlockchainExplorerRouterTestFixture.js';
import {
	AccountFederationService,
	accountFederationRouter
} from '../AccountFederationRouter.js';
import {
	currentFederationEvidence,
	type CurrentFederationSource
} from '../CurrentAccountFederationEvidence.js';

const now = Date.parse('2026-11-07T22:35:22.142Z');
const config = {
	url: 'https://provider.example.org/',
	hostname: 'provider.example.org'
};
const value: ExplorerAccountDTO = {
	accountId,
	source: 'horizon',
	homeDomain: 'example.org',
	balances: [],
	lastModifiedLedger: '65169712',
	sequence: '1',
	subentryCount: 0,
	accounting: {
		scope: 'horizon_account_balances',
		networkPassphrase: Networks.TESTNET,
		snapshotStatus: 'ledger_bound',
		latestLedger: '65360975',
		ledgerClosedAt: '2026-11-07T22:35:17Z',
		baseReserveRaw: '5000000',
		baseReserveLedger: '65360975',
		subentryCount: '0',
		numSponsoring: '0',
		numSponsored: '0',
		balanceInventoryComplete: true
	},
	provider: {
		mode: 'operator_alternate',
		hostname: config.hostname,
		observedAt: new Date(now).toISOString()
	}
};
const display = {
	status: 'display_only' as const,
	accountId,
	stellarAddress: 'fixture*alias.example',
	memo: { type: 'text' as const, value: '0007' },
	homeDomain: 'example.org',
	aliasDomain: 'alias.example',
	reverseProviderOrigin: 'https://provider.example',
	forwardProviderOrigin: 'https://alias.example'
};
function fixture(account: ExplorerAccountDTO | null = value) {
	const fetchAccount = jest
		.fn<typeof fetchExplorerAccount>()
		.mockResolvedValue(account);
	const provider = createExplorerAccountProvider(config, Networks.TESTNET, {
		now: () => now,
		fetchAccount
	});
	const source: CurrentFederationSource = {
		provider,
		networkPassphrase: Networks.TESTNET
	};
	const indexed = jest.fn(async () => {
		throw new Error(
			'Warehouse must not be queried in the configured current lane'
		);
	});
	const lookup = jest.fn(async () => display);
	const service = new AccountFederationService(
		indexed,
		lookup,
		async () => undefined,
		() => now,
		source
	);
	const app = express().use(
		'/v1/explorer',
		accountFederationRouter('testnet', service)
	);
	return { provider, source, fetchAccount, indexed, lookup, service, app };
}
const path = '/v1/explorer/accounts/' + accountId + '/federation';

it('uses fresh current metadata even when the account entry last changed long before warehouse coverage', async () => {
	const f = fixture();
	const result = await request(f.app)
		.get(path)
		.expect(200)
		.expect('Cache-Control', 'no-store');
	expect(result.body).toEqual({
		...display,
		network: 'testnet',
		observedLedger: '65360975'
	});
	expect(result.headers.etag).toBeUndefined();
	expect(f.indexed).not.toHaveBeenCalled();
	expect(f.lookup).toHaveBeenCalledWith(accountId, 'example.org');
	await request(f.app).get(path).expect(200);
	expect(f.fetchAccount).toHaveBeenCalledTimes(1);
	expect(f.lookup).toHaveBeenCalledTimes(2); // only ledger metadata is cached, never federation replies
});
it('shares one provider read and admission budget with the actual current-account route', async () => {
	const f = fixture();
	const accountApp = buildTestApp({ accountProviderService: f.provider });
	const [account, federation] = await Promise.all([
		request(accountApp)
			.get('/v1/explorer/accounts/' + accountId)
			.expect(200)
			.expect('Cache-Control', 'no-store'),
		request(f.app).get(path).expect(200)
	]);
	expect(account.body.homeDomain).toBe('example.org');
	expect(federation.body.status).toBe('display_only');
	expect(f.fetchAccount).toHaveBeenCalledTimes(1);
	await expect(
		f.provider.read('another-account', new AbortController().signal)
	).rejects.toMatchObject({ status: 429 });
});
it.each([null, { ...value, homeDomain: null }])(
	'does not revive an absent account/domain from historical evidence',
	async (account) => {
		const f = fixture(account);
		expect((await request(f.app).get(path).expect(200)).body.status).toBe(
			'unsupported'
		);
		expect(f.indexed).not.toHaveBeenCalled();
		expect(f.lookup).not.toHaveBeenCalled();
	}
);
it.each([
	{ ...value, accountId: 'different' },
	{ ...value, homeDomain: undefined },
	{ ...value, homeDomain: 'http://invalid.example' },
	{
		...value,
		provider: { ...value.provider!, hostname: 'another.example.org' }
	},
	{
		...value,
		provider: {
			...value.provider!,
			observedAt: new Date(now - 30_001).toISOString()
		}
	},
	{
		...value,
		provider: {
			...value.provider!,
			observedAt: new Date(now + 1).toISOString()
		}
	},
	{
		...value,
		accounting: { ...value.accounting!, networkPassphrase: Networks.PUBLIC }
	},
	{
		...value,
		accounting: { ...value.accounting!, ledgerClosedAt: '2026-11-07T22:20:00Z' }
	},
	{ ...value, accounting: { ...value.accounting!, ledgerClosedAt: null } },
	{ ...value, accounting: { ...value.accounting!, latestLedger: '65169711' } }
])('fails closed on inconsistent or stale current evidence %#', (account) => {
	const f = fixture();
	expect(
		currentFederationEvidence(accountId, account, f.source, now).status
	).toBe('indexed_evidence_insufficient');
});
it('preserves provider Retry-After and does not fall back to the warehouse or a second provider', async () => {
	const f = fixture();
	f.fetchAccount.mockRejectedValueOnce(new HorizonAccountReadError(60));
	// The shared provider wraps transport errors as temporary failure and preserves cooldown.
	const result = await request(f.app).get(path).expect(503);
	expect(result.body.status).toBe('temporary_failure');
	expect(f.indexed).not.toHaveBeenCalled();
	expect(f.lookup).not.toHaveBeenCalled();
	const throttled = fixture();
	await throttled.provider.read(accountId, new AbortController().signal);
	const blocked = new AccountFederationService(
		throttled.indexed,
		throttled.lookup,
		async () => undefined,
		() => now,
		{
			...throttled.source,
			provider: {
				...throttled.provider,
				read: async () => {
					throw new ExplorerAccountProviderError(429, 60);
				}
			}
		}
	);
	expect(await blocked.resolve(accountId)).toEqual({
		status: 'throttled',
		retryAtMs: now + 60_000
	});
});
it('checks the resolver account and lets admitted work finish during drain', async () => {
	const f = fixture();
	f.lookup.mockResolvedValueOnce({ ...display, accountId: 'different' });
	expect((await f.service.resolve(accountId)).status).toBe('mismatch');
	let finish!: (account: ExplorerAccountDTO) => void;
	// A fresh provider instance is only a test harness; production composition shares one.
	const pending = fixture();
	pending.fetchAccount.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	const active = pending.service.resolve(accountId);
	await Promise.resolve();
	expect(await pending.service.drain(1)).toBe(false);
	finish(value);
	expect((await active).status).toBe('temporary_failure');
	expect(pending.lookup).not.toHaveBeenCalled();
	expect(await pending.service.drain()).toBe(true);
});
