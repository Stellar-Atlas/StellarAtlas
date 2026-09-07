import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { registerHubbleExplorerRoutes } from '../HubbleExplorerRoutes.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
const ledger = 63490364;
const common = {
	_ledger_sequence: ledger,
	_batch_id: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
	_source_sha256: 'a'.repeat(64),
	_row_number: '9007199254740993',
	closed_at: '2026-07-15 16:43:50',
	ledger_closed_at: '2026-07-15 16:43:50',
	selling_asset_type: 'native',
	selling_asset_code: '',
	selling_asset_issuer: '',
	buying_asset_type: 'native',
	buying_asset_code: '',
	buying_asset_issuer: ''
};
const trade = {
	...common,
	history_operation_id: '272689036991197185',
	order: 0,
	selling_account_address: '',
	buying_account_address: '',
	selling_amount: 0.0009571,
	buying_amount: 0.0488962,
	price_n: '488962',
	price_d: '9571'
};
const offer = {
	...common,
	offer_id: '1848813589',
	seller_id: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ',
	amount: 1074.6636081,
	pricen: '5003537',
	priced: '5000000',
	deleted: false,
	last_modified_ledger: ledger
};
describe('existing-service GraphQL trades and offers', () => {
	it.each([
		[
			'trades',
			'hubbleTrades',
			trade,
			'id operationId sellingAmount buyingAmount'
		],
		['offers', 'hubbleOffers', offer, 'id seller amount deleted']
	] as const)(
		'shares REST %s service filters, offsets and precision disclosure',
		async (entity, field, row, selection) => {
			const w = mock<HubbleWarehouse>();
			w.catalog.mockResolvedValue({
				coverage: summarizeHubbleLedgerCoverage([
					{ start_ledger: 2, end_ledger: 10 },
					{ start_ledger: ledger - 1, end_ledger: ledger + 1 }
				])
			} as never);
			w.query.mockImplementation(async (input) => ({
				rows: [row],
				columns: [],
				dataset: input.dataset,
				limit: input.limit!,
				offset: input.offset!,
				elapsedMilliseconds: 1
			}));
			const app = express(),
				router = express.Router();
			app.use(express.json());
			registerHubbleExplorerRoutes(router, w);
			app.use('/v1/analytics', router);
			app.all('/graphql', hubbleWarehouseGraphqlHandler(w));
			const rest = await request(app)
				.get(
					'/v1/analytics/' +
						entity +
						'?view=typed&min_ledger=' +
						ledger +
						'&max_ledger=' +
						ledger +
						'&limit=1&offset=2&selling_asset=native'
				)
				.expect(200);
			const restQuery = w.query.mock.calls[0]![0];
			const gql = await request(app)
				.post('/graphql')
				.send({
					query:
						'{ ' +
						field +
						'(input:{minLedger:' +
						ledger +
						',maxLedger:' +
						ledger +
						',limit:1,offset:2,sellingAsset:"native"}) { rows { ' +
						selection +
						' amountPrecision price { numerator denominator } sourceRecord { rowNumber } } nextOffset coverageStatus coverage { contiguousLastLedger gapCount completedRanges { firstLedger lastLedger } } } }'
				})
				.expect(200);
			expect(gql.body.errors).toBeUndefined();
			expect(gql.body.data[field]).toMatchObject({
				coverageStatus: 'complete',
				coverage: {
					contiguousLastLedger: '10',
					gapCount: 1,
					completedRanges: [
						{ firstLedger: '2', lastLedger: '10' },
						{ firstLedger: String(ledger - 1), lastLedger: String(ledger + 1) }
					]
				}
			});
			expect(w.query.mock.calls[1]![0]).toEqual(restQuery);
			expect(gql.body.data[field].rows[0]).toMatchObject({
				id: rest.body.rows[0].id,
				amountPrecision: 'source_float64',
				price: rest.body.rows[0].price,
				sourceRecord: { rowNumber: '9007199254740993' }
			});
			const detailField = entity === 'trades' ? 'hubbleTrade' : 'hubbleOffer';
			const detail = await request(app)
				.post('/graphql')
				.send({
					query:
						'{ ' +
						detailField +
						'(id:"' +
						rest.body.rows[0].id +
						'",input:{minLedger:' +
						ledger +
						',maxLedger:' +
						ledger +
						'}) { record { id amountPrecision } coverageStatus } }'
				})
				.expect(200);
			expect(detail.body.errors).toBeUndefined();
			expect(detail.body.data[detailField].record.id).toBe(
				rest.body.rows[0].id
			);
			const invalid = await request(app)
				.post('/graphql')
				.send({
					query:
						'{ ' + field + '(input:{minLedger:1,maxLedger:1000001}) { limit } }'
				})
				.expect(200);
			expect(invalid.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
		}
	);
});
