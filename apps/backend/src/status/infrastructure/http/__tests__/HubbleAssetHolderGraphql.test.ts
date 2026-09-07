import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import type { HubbleAssetHolderPage } from '../HubbleSemanticWarehouse.js';

const account = 'G' + 'A'.repeat(55),
	nextAccount = 'G' + 'B'.repeat(55);
const coverage = summarizeHubbleLedgerCoverage([
	{ start_ledger: 2, end_ledger: 65 },
	{ start_ledger: 130, end_ledger: 193 }
]);
const watermark: HubbleAssetHolderPage['watermark'] = {
	mode: 'latest-ingested-observations',
	catalogGeneratedAt: '2026-09-07T00:00:00.000Z',
	catalogMaximumLedger: '193',
	snapshotPinned: false
};
const selection =
	'asset limit nextCursor holders { accountId balance amountPrecision buyingLiabilities sellingLiabilities trustLineLimit ledgerSequence } coverage { gapCount contiguousLastLedger maximumLedger } watermark { mode catalogGeneratedAt catalogMaximumLedger snapshotPinned }';
const listQuery =
	'query Holders($asset:String!,$input:HubbleAssetHolderInput) { hubbleAssetHolders(asset:$asset,input:$input) { ' +
	selection +
	' } }';
function fixture() {
	const warehouse = mock<HubbleWarehouse>();
	warehouse.assetHolders.mockImplementation(async (input) => ({
		asset:
			input.asset.type === 'native'
				? 'native'
				: input.asset.code + ':' + input.asset.issuer,
		holders: [
			{
				account_id: input.after ? nextAccount : account,
				balance: input.after ? '0.10000000000000001' : 12.25,
				buying_liabilities: 0.0000001,
				selling_liabilities: '0.0000002',
				trust_line_limit: '9223372036854775807',
				ledger_sequence: 193
			}
		],
		limit: input.limit ?? 100,
		nextCursor: input.after ? null : account,
		coverage,
		watermark,
		elapsedMilliseconds: 1
	}));
	const app = express();
	app.use(express.json());
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, warehouse };
}
describe('typed GraphQL asset holders', () => {
	it('reuses the REST service, asset parsing and account cursor without numeric coercion', async () => {
		const f = fixture();
		const asset = 'USD:' + nextAccount;
		const rest = await request(f.app)
			.get(
				'/v1/analytics/assets/' + encodeURIComponent(asset) + '/holders?limit=1'
			)
			.expect(200);
		const first = await request(f.app)
			.post('/graphql')
			.send({ query: listQuery, variables: { asset, input: { limit: 1 } } })
			.expect(200);
		expect(first.body.errors).toBeUndefined();
		expect(f.warehouse.assetHolders.mock.calls[1]).toEqual(
			f.warehouse.assetHolders.mock.calls[0]
		);
		const page = first.body.data.hubbleAssetHolders;
		expect(page).toMatchObject({
			asset,
			nextCursor: rest.body.nextCursor,
			coverage: {
				gapCount: 1,
				contiguousLastLedger: '65',
				maximumLedger: '193'
			},
			watermark,
			holders: [
				{
					accountId: account,
					balance: 12.25,
					amountPrecision: 'float64-observation',
					buyingLiabilities: 0.0000001,
					sellingLiabilities: '0.0000002',
					trustLineLimit: '9223372036854775807',
					ledgerSequence: '193'
				}
			]
		});
		const second = await request(f.app)
			.post('/graphql')
			.send({
				query: listQuery,
				variables: { asset, input: { limit: 1, after: page.nextCursor } }
			})
			.expect(200);
		expect(second.body.errors).toBeUndefined();
		expect(second.body.data.hubbleAssetHolders).toMatchObject({
			nextCursor: null,
			holders: [
				{
					accountId: nextAccount,
					balance: '0.10000000000000001',
					amountPrecision: 'float64-observation'
				}
			]
		});
		expect(f.warehouse.assetHolders).toHaveBeenLastCalledWith({
			asset: { type: 'issued', code: 'USD', issuer: nextAccount },
			limit: 1,
			after: account
		});
		expect(f.warehouse.query).not.toHaveBeenCalled();
		expect(f.warehouse.catalog).not.toHaveBeenCalled();
	});

	it('keeps coverage visible when a specific holder has no positive latest-ingested balance', async () => {
		const f = fixture();
		f.warehouse.assetHolders.mockResolvedValue({
			asset: 'native',
			holders: [],
			coverage,
			watermark,
			limit: 1,
			nextCursor: null,
			elapsedMilliseconds: 1
		});
		const response = await request(f.app)
			.post('/graphql')
			.send({
				query:
					'query($account:String!) { hubbleAssetHolder(asset:"NATIVE",account:$account) { asset holder { accountId balance } coverage { gapCount } watermark { mode snapshotPinned } } }',
				variables: { account }
			})
			.expect(200);
		expect(response.body.errors).toBeUndefined();
		expect(response.body.data.hubbleAssetHolder).toEqual({
			asset: 'native',
			holder: null,
			coverage: { gapCount: 1 },
			watermark: { mode: 'latest-ingested-observations', snapshotPinned: false }
		});
		expect(f.warehouse.assetHolders).toHaveBeenCalledWith({
			asset: { type: 'native' },
			account,
			limit: 1
		});
	});

	it.each([
		{ asset: 'not-an-asset', input: {} },
		{ asset: 'native', input: { limit: 0 } },
		{ asset: 'native', input: { limit: 201 } },
		{ asset: 'native', input: { after: '' } }
	])(
		'validates holder arguments before warehouse access: %j',
		async (variables) => {
			const f = fixture();
			const response = await request(f.app)
				.post('/graphql')
				.send({ query: listQuery, variables })
				.expect(200);
			expect(response.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
			expect(f.warehouse.assetHolders).not.toHaveBeenCalled();
		}
	);

	it('rejects invalid accounts and unsupported as-of fields instead of silently returning latest state', async () => {
		const f = fixture();
		const invalid = await request(f.app)
			.post('/graphql')
			.send({
				query:
					'{ hubbleAssetHolder(asset:"native",account:"invalid") { asset } }'
			})
			.expect(200);
		expect(invalid.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
		const unsupported = await request(f.app)
			.post('/graphql')
			.send({
				query:
					'{ hubbleAssetHolders(asset:"native",input:{asOfLedger:65}) { limit } }'
			})
			.expect(200);
		expect(unsupported.body.errors[0].message).toContain('asOfLedger');
		expect(unsupported.body.errors[0].message).toContain('not defined');
		expect(unsupported.body.data).toBeUndefined();
		expect(f.warehouse.assetHolders).not.toHaveBeenCalled();
	});

	it('rejects malformed source amounts rather than manufacturing zero or exact precision', async () => {
		const f = fixture();
		f.warehouse.assetHolders.mockResolvedValue({
			asset: 'native',
			holders: [{ account_id: account, balance: 'NaN' }],
			coverage,
			watermark,
			limit: 1,
			nextCursor: null,
			elapsedMilliseconds: 1
		});
		const log = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		try {
			const response = await request(f.app)
				.post('/graphql')
				.send({ query: listQuery, variables: { asset: 'native' } })
				.expect(200);
			expect(response.body.errors[0].extensions.code).toBe(
				'SERVICE_UNAVAILABLE'
			);
			expect(response.body.data).toBeNull();
		} finally {
			log.mockRestore();
		}
	});
});
