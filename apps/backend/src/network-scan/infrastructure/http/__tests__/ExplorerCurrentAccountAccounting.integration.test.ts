import request from 'supertest';
import { fetchExplorerAccount } from '../ExplorerAccountClient.js';
import {
	buildTestApp,
	canonicalSourceAccount as accountId
} from './BlockchainExplorerRouterTestFixture.js';

const route = '/v1/explorer/accounts/' + accountId;
const horizon = 'https://horizon.example';
const networkPassphrase = 'Test SDF Network ; September 2015';
const snapshot = '63386340';
const modified = 63386303;
const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const pool = 'ab'.repeat(32);
const ledgerClosedAt = '2026-11-05T21:50:00Z';
const native = {
	asset_type: 'native',
	balance: '10.0000000',
	buying_liabilities: '0.0000000',
	selling_liabilities: '1.2500000'
};
const credit = {
	asset_type: 'credit_alphanum4',
	asset_code: 'USDC',
	asset_issuer: issuer,
	balance: '0.0000000',
	buying_liabilities: '0.0000001',
	selling_liabilities: '0.0000000',
	limit: '922337203685.4775807',
	is_authorized: false,
	is_authorized_to_maintain_liabilities: true,
	is_clawback_enabled: false,
	sponsor: issuer
};
const shares = {
	asset_type: 'liquidity_pool_shares',
	liquidity_pool_id: pool,
	balance: '0.0000001',
	limit: '922337203685.4775807'
};
const account = {
	account_id: accountId,
	balances: [native, credit, shares],
	last_modified_ledger: modified,
	sequence: '9223372036854775807',
	subentry_count: 3,
	num_sponsoring: 2,
	num_sponsored: 1
};

function accountResponse(
	body: unknown = account,
	latestLedger: string | null = snapshot
): Response {
	return Response.json(body, {
		headers: latestLedger === null ? {} : { 'Latest-Ledger': latestLedger }
	});
}

function ledgerResponse(
	sequence = Number(snapshot),
	reserve: unknown = 5_000_000,
	closedAt: unknown = ledgerClosedAt
): Response {
	return Response.json({
		sequence,
		closed_at: closedAt,
		base_reserve_in_stroops: reserve
	});
}

afterEach(() => jest.restoreAllMocks());

it('adds network-bound exact inputs and loads only the account snapshot ledger from the configured origin', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(accountResponse())
		.mockResolvedValueOnce(ledgerResponse());
	const timeout = jest.spyOn(AbortSignal, 'timeout');
	const result = await request(buildTestApp())
		.get(route)
		.expect(200)
		.expect('Cache-Control', 'public, max-age=20');

	expect(result.body).toMatchObject({
		accountId,
		source: 'horizon',
		lastModifiedLedger: modified.toString(),
		sequence: '9223372036854775807',
		subentryCount: 3,
		accounting: {
			scope: 'horizon_account_balances',
			networkPassphrase,
			snapshotStatus: 'ledger_bound',
			latestLedger: snapshot,
			ledgerClosedAt,
			baseReserveRaw: '5000000',
			baseReserveLedger: snapshot,
			subentryCount: '3',
			numSponsoring: '2',
			numSponsored: '1',
			balanceInventoryComplete: true
		},
		balances: [
			{
				assetType: 'native',
				balance: native.balance,
				exact: {
					assetId: 'native',
					balanceRaw: '100000000',
					sellingLiabilities: '1.2500000',
					sellingLiabilitiesRaw: '12500000',
					buyingLiabilitiesRaw: '0',
					trustLineLimitRaw: null,
					isAuthorized: null
				}
			},
			{
				assetType: 'credit_alphanum4',
				assetCode: 'USDC',
				assetIssuer: issuer,
				balance: credit.balance,
				exact: {
					assetId: 'USDC:' + issuer,
					balanceRaw: '0',
					buyingLiabilities: '0.0000001',
					buyingLiabilitiesRaw: '1',
					sellingLiabilitiesRaw: '0',
					trustLineLimit: credit.limit,
					trustLineLimitRaw: '9223372036854775807',
					isAuthorized: false,
					isAuthorizedToMaintainLiabilities: true,
					isClawbackEnabled: false,
					sponsor: issuer
				}
			},
			{
				assetType: 'liquidity_pool_shares',
				exact: {
					assetId: 'liquidity_pool_shares:' + pool,
					liquidityPoolId: pool,
					balanceRaw: '1',
					buyingLiabilitiesRaw: null,
					sellingLiabilitiesRaw: null
				}
			}
		]
	});
	expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
		horizon + '/accounts/' + accountId,
		horizon + '/ledgers/' + snapshot
	]);
	const accountInit = fetch.mock.calls[0]?.[1];
	const ledgerInit = fetch.mock.calls[1]?.[1];
	expect(accountInit?.signal).toBe(ledgerInit?.signal);
	expect(accountInit?.redirect).toBe('error');
	expect(ledgerInit?.redirect).toBe('error');
	expect(timeout.mock.calls.map(([ms]) => ms)).toContain(65_000);
	expect(timeout.mock.calls.map(([ms]) => ms)).not.toContain(8_000);
});

it.each([
	null,
	'0',
	'4294967296',
	'63386340, 63386341',
	modified.toString().replace(/.$/, '0')
])(
	'withholds snapshot and reserve when Latest-Ledger is invalid or missing (%s)',
	async (marker) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(accountResponse(account, marker));
		const result = await request(buildTestApp()).get(route).expect(200);
		expect(result.body.accounting).toMatchObject({
			snapshotStatus: 'ledger_unavailable',
			latestLedger: null,
			baseReserveRaw: null,
			baseReserveLedger: null,
			balanceInventoryComplete: false
		});
		expect(result.body.lastModifiedLedger).toBe(modified.toString());
		expect(result.body.balances[0].exact.balanceRaw).toBe('100000000');
		expect(fetch).toHaveBeenCalledTimes(1);
	}
);

it.each([
	['older sequence', () => ledgerResponse(Number(snapshot) - 1)],
	['newer sequence', () => ledgerResponse(Number(snapshot) + 1)],
	['fractional reserve', () => ledgerResponse(Number(snapshot), 1.25)],
	['overflow reserve', () => ledgerResponse(Number(snapshot), 4294967296)],
	['ledger unavailable', () => new Response(null, { status: 503 })]
] as const)(
	'keeps account inputs and withholds unmatched or invalid reserve evidence (%s)',
	async (_name, fixture) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(accountResponse())
			.mockResolvedValueOnce(fixture());
		const result = await request(buildTestApp()).get(route).expect(200);
		expect(result.body.accounting).toMatchObject({
			snapshotStatus: 'ledger_bound',
			latestLedger: snapshot,
			baseReserveRaw: null,
			baseReserveLedger: null,
			balanceInventoryComplete: true
		});
		expect(result.body.balances[0].exact.sellingLiabilitiesRaw).toBe(
			'12500000'
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	}
);

it('retains zero but reports unknown for absent or non-exact counters, decimal strings and flags', async () => {
	const malformed = {
		...account,
		num_sponsoring: undefined,
		num_sponsored: 0,
		balances: [
			{ ...native, selling_liabilities: 0 },
			{
				...credit,
				balance: '922337203685.4775808',
				buying_liabilities: '0.00000001',
				is_authorized: 'false',
				is_authorized_to_maintain_liabilities: undefined
			}
		]
	};
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(accountResponse(malformed));
	const result = await request(buildTestApp()).get(route).expect(200);
	expect(result.body.accounting).toMatchObject({
		numSponsoring: null,
		numSponsored: '0',
		balanceInventoryComplete: false,
		baseReserveRaw: null,
		baseReserveLedger: null
	});
	expect(result.body.balances[0].exact).toMatchObject({
		sellingLiabilities: null,
		sellingLiabilitiesRaw: null
	});
	expect(result.body.balances[1].exact).toMatchObject({
		balanceRaw: null,
		buyingLiabilitiesRaw: null,
		sellingLiabilitiesRaw: '0',
		isAuthorized: null,
		isAuthorizedToMaintainLiabilities: null
	});
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('marks a duplicate or native-missing inventory incomplete and skips reserve lookup', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(
			accountResponse({ ...account, balances: [native, native] })
		)
		.mockResolvedValueOnce(accountResponse({ ...account, balances: [credit] }));
	for (let count = 0; count < 2; count++) {
		const result = await request(buildTestApp()).get(route).expect(200);
		expect(result.body.accounting).toMatchObject({
			balanceInventoryComplete: false,
			baseReserveRaw: null
		});
	}
	expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps the account finder on one legacy lookup', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(accountResponse());
	const result = await request(buildTestApp())
		.get('/v1/explorer/search')
		.query({ query: accountId, type: 'account' })
		.expect(200);
	expect(result.body.result.accounting).toBeUndefined();
	expect(result.body.result.balances[0].exact).toBeUndefined();
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('distinguishes Horizon account absence from malformed, unrelated or failed provider data', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(
			Response.json(
				{ status: 404, type: 'https://stellar.org/horizon-errors/not_found' },
				{ status: 404 }
			)
		)
		.mockResolvedValueOnce(
			new Response('<h1>Proxy route missing</h1>', { status: 404 })
		)
		.mockResolvedValueOnce(accountResponse({ ...account, account_id: issuer }))
		.mockResolvedValueOnce(accountResponse({ ...account, balances: undefined }))
		.mockResolvedValueOnce(new Response(null, { status: 503 }));
	const app = buildTestApp();
	await request(app).get(route).expect(404);
	for (let count = 0; count < 4; count++) {
		await request(app)
			.get(route)
			.expect(502)
			.expect('Cache-Control', 'no-store')
			.expect({ error: 'Account lookup unavailable' });
	}
	expect(fetch).toHaveBeenCalledTimes(5);
});

it.each([
	['negative subentry count', { subentry_count: -1 }],
	['fractional subentry count', { subentry_count: 0.5 }],
	['overflowing subentry count', { subentry_count: 4294967296 }],
	['missing subentry count', { subentry_count: undefined }],
	['nonnumeric sequence', { sequence: 'bad-sequence' }],
	['negative sequence', { sequence: '-1' }],
	['overflowing sequence', { sequence: '9223372036854775808' }],
	['numeric asset type', { balances: [{ ...native, asset_type: 3 }] }],
	['numeric asset code', { balances: [{ ...credit, asset_code: 3 }] }],
	['numeric asset issuer', { balances: [{ ...credit, asset_issuer: 3 }] }],
	['numeric balance', { balances: [{ ...native, balance: 3 }] }]
] as const)(
	'rejects malformed required account evidence before reading a ledger (%s)',
	async (_name, override) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(accountResponse({ ...account, ...override }));
		await request(buildTestApp())
			.get(route)
			.expect(502)
			.expect('Cache-Control', 'no-store')
			.expect({ error: 'Account lookup unavailable' });
		expect(fetch).toHaveBeenCalledTimes(1);
	}
);

it('keeps classic detail wire validation out of the legacy finder', async () => {
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
		accountResponse({
			...account,
			subentry_count: -0.5,
			sequence: 'legacy-sequence'
		})
	);
	const response = await request(buildTestApp())
		.get('/v1/explorer/search')
		.query({ query: accountId, type: 'account' })
		.expect(200);
	expect(response.body.result).toMatchObject({
		subentryCount: -0.5,
		sequence: 'legacy-sequence'
	});
	expect(response.body.result.accounting).toBeUndefined();
	expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
	['2026', null],
	['2026-11-05', null],
	['2026-11-05T21:50:00', null],
	['2026-02-29T21:50:00Z', null],
	['2026-04-31T21:50:00+02:00', null],
	['2026-11-05T24:00:00Z', null],
	['2026-11-05T21:50:00+25:00', null],
	['2024-02-29T21:50:00.123456789+02:30', '2024-02-29T21:50:00.123456789+02:30']
] as const)(
	'validates optional ledger time independently of matched reserve (%s)',
	async (closedAt, expected) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				accountResponse({ ...account, subentry_count: 0, sequence: '0' })
			)
			.mockResolvedValueOnce(
				ledgerResponse(Number(snapshot), 5_000_000, closedAt)
			);
		const response = await request(buildTestApp()).get(route).expect(200);
		expect(response.body).toMatchObject({
			subentryCount: 0,
			sequence: '0',
			accounting: {
				subentryCount: '0',
				ledgerClosedAt: expected,
				baseReserveRaw: '5000000',
				baseReserveLedger: snapshot,
				balanceInventoryComplete: true
			}
		});
		expect(fetch).toHaveBeenCalledTimes(2);
	}
);

it('shares caller cancellation with the in-progress exact ledger read', async () => {
	const controller = new AbortController();
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(accountResponse())
		.mockImplementationOnce(async (_url, options) => {
			expect(options?.signal?.aborted).toBe(false);
			controller.abort();
			expect(options?.signal?.aborted).toBe(true);
			return ledgerResponse();
		});
	const result = await fetchExplorerAccount(horizon, accountId, {
		networkPassphrase,
		signal: controller.signal
	});
	expect(result?.accounting?.baseReserveRaw).toBeNull();
	expect(fetch).toHaveBeenCalledTimes(2);
});
