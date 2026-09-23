import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { StrKey } from '@stellar/stellar-sdk';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { registerHubbleAccountBalanceRoutes } from '../HubbleAccountBalanceRoutes.js';
import { encodeBalanceCursor } from '../HubbleAccountBalanceCursor.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type { HubbleAccountBalancePage } from '../HubbleAccountBalanceContracts.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';

const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const cursor = encodeBalanceCursor(account, { kind: 0, code: '', issuer: '' });
const page: HubbleAccountBalancePage = {
	account,
	balanceScope: 'native-and-issued',
	balances: [
		{
			asset: 'native',
			assetType: 'native',
			assetCode: null,
			assetIssuer: null,
			balance: 0,
			balanceRaw: null,
			amountPrecision: 'float64-observation',
			buyingLiabilities: 1.25,
			sellingLiabilities: 2.5,
			trustLineLimitRaw: '9223372036854775807',
			flags: 0,
			lastModifiedLedger: 12,
			observedLedger: 65
		}
	],
	limit: 1,
	nextCursor: cursor,
	elapsedMilliseconds: 1,
	coverage: summarizeHubbleLedgerCoverage([
		{ start_ledger: 2, end_ledger: 65 },
		{ start_ledger: 130, end_ledger: 193 }
	]),
	watermark: {
		mode: 'latest-ingested-observations',
		catalogGeneratedAt: '2026-09-07T00:00:00.000Z',
		catalogMaximumLedger: '193',
		snapshotPinned: false
	}
};
const query =
	'query($account:String!,$input:HubbleAccountBalanceInput) { hubbleAccountBalances(account:$account,input:$input) { account balanceScope limit nextCursor elapsedMilliseconds balances { asset assetType assetCode assetIssuer balance balanceRaw amountPrecision buyingLiabilities sellingLiabilities trustLineLimitRaw flags lastModifiedLedger observedLedger } coverage { gapCount maximumLedger } watermark { mode catalogGeneratedAt catalogMaximumLedger snapshotPinned } } }';
function fixture() {
	const warehouse = mock<HubbleWarehouse>();
	warehouse.accountBalances.mockResolvedValue(page);
	const app = express(),
		router = express.Router();
	app.use(express.json());
	registerHubbleAccountBalanceRoutes(router, warehouse);
	app.use('/v1/analytics', router);
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, warehouse };
}
describe('typed GraphQL account balance observations', () => {
	it('shares REST service input, preserves native zero and precision/coverage, and uses the same account cursor', async () => {
		const f = fixture();
		const rest = await request(f.app)
			.get('/v1/analytics/accounts/' + account + '/balances?limit=1')
			.expect(200);
		const first = await request(f.app)
			.post('/graphql')
			.send({ query, variables: { account, input: { limit: 1 } } })
			.expect(200);
		expect(first.body.errors).toBeUndefined();
		expect(f.warehouse.accountBalances.mock.calls[1]).toEqual(
			f.warehouse.accountBalances.mock.calls[0]
		);
		expect(first.body.data.hubbleAccountBalances).toMatchObject({
			account,
			balanceScope: 'native-and-issued',
			nextCursor: rest.body.nextCursor,
			balances: [{ ...page.balances[0], flags: '0' }],
			coverage: { gapCount: 1, maximumLedger: '193' },
			watermark: page.watermark
		});
		f.warehouse.accountBalances.mockResolvedValue({
			...page,
			balances: [],
			nextCursor: null
		});
		const second = await request(f.app)
			.post('/graphql')
			.send({
				query,
				variables: { account, input: { limit: 1, after: cursor } }
			})
			.expect(200);
		expect(second.body.errors).toBeUndefined();
		expect(second.body.data.hubbleAccountBalances).toMatchObject({
			balances: [],
			nextCursor: null,
			watermark: { snapshotPinned: false }
		});
		expect(f.warehouse.accountBalances).toHaveBeenLastCalledWith({
			account,
			after: cursor,
			limit: 1
		});
		expect(f.warehouse.query).not.toHaveBeenCalled();
		expect(f.warehouse.catalog).not.toHaveBeenCalled();
	});
	it.each([
		{ account: 'G' + 'A'.repeat(55), input: {} },
		{ account, input: { limit: 0 } },
		{ account, input: { limit: 201 } },
		{ account, input: { after: '' } },
		{ account, input: { after: 'garbage' } },
		{
			account,
			input: {
				after: encodeBalanceCursor(issuer, { kind: 0, code: '', issuer: '' })
			}
		}
	])(
		'validates account, limit and cursor scope before warehouse access: %j',
		async (variables) => {
			const f = fixture();
			const result = await request(f.app)
				.post('/graphql')
				.send({ query, variables })
				.expect(200);
			expect(result.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
			expect(f.warehouse.accountBalances).not.toHaveBeenCalled();
		}
	);
	it('defaults nullable pagination without inventing current/as-of state', async () => {
		const f = fixture();
		await request(f.app)
			.post('/graphql')
			.send({
				query,
				variables: { account, input: { limit: null, after: null } }
			})
			.expect(200);
		expect(f.warehouse.accountBalances).toHaveBeenCalledWith({
			account,
			after: undefined,
			limit: 100
		});
		f.warehouse.accountBalances.mockClear();
		const unsupported = await request(f.app)
			.post('/graphql')
			.send({ query, variables: { account, input: { asOfLedger: 65 } } })
			.expect(200);
		expect(unsupported.body.errors[0].message).toContain('asOfLedger');
		expect(unsupported.body.data).toBeUndefined();
		expect(f.warehouse.accountBalances).not.toHaveBeenCalled();
	});
	it('does not turn an unavailable warehouse into zero balances', async () => {
		const f = fixture(),
			log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		f.warehouse.accountBalances.mockRejectedValue(
			new HubbleWarehouseUnavailableError('fixture unavailable')
		);
		try {
			const result = await request(f.app)
				.post('/graphql')
				.send({ query, variables: { account } })
				.expect(200);
			expect(result.body.errors[0].extensions.code).toBe('SERVICE_UNAVAILABLE');
			expect(result.body.data).toBeNull();
		} finally {
			log.mockRestore();
		}
	});
});
