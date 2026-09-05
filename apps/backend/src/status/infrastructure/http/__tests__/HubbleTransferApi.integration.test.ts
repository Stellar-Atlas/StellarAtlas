import express from 'express';
import request from 'supertest';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { mapHubbleTransfer } from '../HubbleTransferMapper.js';
import { transferAccount, transferRow } from './HubbleTransferFixture.js';

const page = {
	transfers: [mapHubbleTransfer(transferRow())],
	limit: 10,
	nextCursor: null,
	watermark: {
		minimumLedger: 10,
		maximumLedger: 65,
		observedAt: '2026-09-05T00:00:00.000Z',
		coverage: 'ingested-only'
	},
	elapsedMilliseconds: 1
};
function fixture() {
	const transferActivity = jest.fn().mockResolvedValue(page);
	const warehouse: HubbleWarehouse = {
		transferActivity,
		classifyEventRows: jest.fn(),
		accountTransactions: jest.fn(),
		assetHolders: jest.fn(),
		catalog: jest.fn(),
		query: jest.fn()
	};
	const app = express();
	app.use(express.json());
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, transferActivity, warehouse };
}
describe('typed transfer REST and GraphQL parity', () => {
	it.each([
		['/activity/transfers', 'hubbleTransfers', '', {}],
		[
			'/accounts/' + transferAccount + '/activity/transfers',
			'hubbleAccountTransfers',
			'account: $account, ',
			{ account: transferAccount }
		],
		[
			'/assets/native/activity/transfers',
			'hubbleAssetTransfers',
			'asset: $asset, ',
			{ asset: 'native' }
		]
	] as const)(
		'normalizes REST %s identically to typed GraphQL',
		async (path, field, args, scope) => {
			const { app, transferActivity } = fixture();
			await request(app)
				.get(
					'/v1/analytics' +
						path +
						'?limit=10&min_ledger=10&max_ledger=65&min_amount_raw=9007199254740993&event_topic=transfer&start_time=2026-09-01T00:00:00Z&end_time=2026-09-02T00:00:00Z'
				)
				.expect(200);
			const restInput: unknown = transferActivity.mock.calls[0]![0];
			const scopeDefinition =
				'account' in scope
					? ', $account: String!'
					: 'asset' in scope
						? ', $asset: String!'
						: '';
			const response = await request(app)
				.post('/graphql')
				.send({
					query:
						'query($input: HubbleTransferInput' +
						scopeDefinition +
						') { ' +
						field +
						'(' +
						args +
						'input: $input) { transfers { id amountRaw amountScale transactionId operationId eventTopic asset { id type code issuer } } limit nextCursor watermark { minimumLedger maximumLedger observedAt coverage } } }',
					variables: {
						...scope,
						input: {
							limit: 10,
							minLedger: 10,
							maxLedger: 65,
							minAmountRaw: '9007199254740993',
							eventTopic: 'transfer',
							startTime: '2026-09-01T00:00:00Z',
							endTime: '2026-09-02T00:00:00Z'
						}
					}
				})
				.expect(200);
			expect(response.body.errors).toBeUndefined();
			expect(transferActivity.mock.calls[1]![0]).toEqual(restInput);
			expect(response.body.data[field].transfers[0].amountRaw).toBe(
				page.transfers[0]!.amountRaw
			);
			expect(response.body.data[field].transfers[0].asset.type).toBe('native');
		}
	);

	it('rejects unknown, duplicate, invalid, and conflicting REST filters before warehouse access', async () => {
		const { app, transferActivity } = fixture();
		for (const suffix of [
			'?amount=12',
			'?limit=2&limit=3',
			'?event_topic=payment',
			'?min_ledger=20&max_ledger=10'
		])
			await request(app)
				.get('/v1/analytics/activity/transfers' + suffix)
				.expect(400);
		await request(app)
			.get(
				'/v1/analytics/assets/native/activity/transfers?asset=USD:' +
					transferAccount
			)
			.expect(400);
		expect(transferActivity).not.toHaveBeenCalled();
	});

	it('returns typed BAD_USER_INPUT errors and disallows raw JSON selection on transfers', async () => {
		const { app, transferActivity } = fixture();
		const response = await request(app)
			.post('/graphql')
			.send({
				query:
					'{ hubbleTransfers(input: {amountRaw: "1.1"}) { transfers { amountRaw } } }'
			})
			.expect(200);
		expect(response.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
		const invalidSelection = await request(app)
			.post('/graphql')
			.send({
				query: '{ hubbleTransfers { transfers } }'
			})
			.expect(200);
		expect(invalidSelection.body.errors[0].message).toContain('selection');
		expect(transferActivity).not.toHaveBeenCalled();
	});

	it('preserves the legacy transfer response and does not route it to the new method', async () => {
		const { app, transferActivity, warehouse } = fixture();
		jest.mocked(warehouse.query).mockResolvedValue({
			columns: ['amount'],
			dataset: 'token_transfers',
			elapsedMilliseconds: 1,
			limit: 101,
			offset: 0,
			rows: []
		});
		const response = await request(app)
			.get('/v1/analytics/transfers')
			.expect(200);
		expect(response.body).toMatchObject({
			rows: [],
			nextOffset: null,
			offset: 0
		});
		expect(transferActivity).not.toHaveBeenCalled();
	});
});
