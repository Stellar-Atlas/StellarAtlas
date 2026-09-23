import express from 'express';
import request from 'supertest';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { queryHubbleTransactionDetail } from '../HubbleTransactionQuery.js';
import {
	queryFixture,
	transactionFixture,
	transactionHash,
	transactionLedger
} from './HubbleTransactionFixture.js';

async function fixture() {
	const page = await queryHubbleTransactionDetail(queryFixture().executor, {
		transactionHash,
		limit: 1
	});
	const transactionDetail = jest.fn().mockResolvedValue(page);
	const warehouse: HubbleWarehouse = {
		contractEvents: jest.fn(),
		transactionDetail,
		transferActivity: jest.fn(),
		classifyEventRows: jest.fn().mockResolvedValue([]),
		accountTransactions: jest.fn(),
		assetHolders: jest.fn(),
		accountBalances: jest.fn(),
		catalog: jest.fn(),
		query: jest.fn().mockImplementation(async (input) => ({
			dataset: input.dataset,
			columns: [],
			limit: 1,
			offset: 0,
			elapsedMilliseconds: 0,
			rows: input.dataset === 'history_transactions' ? [transactionFixture] : []
		}))
	};
	const app = express();
	app.use(express.json());
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, transactionDetail, page };
}
describe('typed transaction REST/GraphQL parity', () => {
	it('normalizes the same optional ledger hint and independent cursors and returns exact typed data', async () => {
		const { app, transactionDetail, page } = await fixture();
		const rest = await request(app)
			.get(
				'/v1/analytics/transactions/' +
					transactionHash +
					'?view=typed&ledger_sequence=' +
					transactionLedger +
					'&limit=1'
			)
			.expect(200);
		const graphql = await request(app)
			.post('/graphql')
			.send({
				query:
					'query($hash:String!,$ledger:Int){hubbleTransaction(transactionHash:$hash,ledgerSequence:$ledger,limit:1){transaction{id hash ledgerSequence sequence feeChargedRaw} operations{items{id index amounts{field decimal raw scale source}} limit nextCursor} effects{items{id operationId amounts{raw}} limit nextCursor} events{items{id classification{transactionKind eventKind provenance sorobanExecutionEvidence}} limit nextCursor}}}',
				variables: { hash: transactionHash, ledger: transactionLedger }
			})
			.expect(200);
		expect(graphql.body.errors).toBeUndefined();
		expect(transactionDetail.mock.calls[0]![0]).toEqual(
			transactionDetail.mock.calls[1]![0]
		);
		expect(
			graphql.body.data.hubbleTransaction.operations.items[0].amounts[0].raw
		).toBe(rest.body.operations.items[0].amounts[0].raw);
		await request(app)
			.get(
				'/v1/analytics/transactions/' +
					transactionHash +
					'?view=typed&limit=1&effects_after=' +
					page!.effects.nextCursor
			)
			.expect(200);
		expect(transactionDetail.mock.calls[2]![0].effectsAfter).toBe(
			page!.effects.nextCursor
		);
		expect(transactionDetail.mock.calls[2]![0].ledgerSequence).toBeUndefined();
	});
	it('preserves the legacy default representation and rejects malformed typed requests', async () => {
		const { app, transactionDetail } = await fixture();
		const legacy = await request(app)
			.get('/v1/analytics/transactions/' + transactionHash)
			.expect(200);
		expect(Object.keys(legacy.body).sort()).toEqual([
			'contractEvents',
			'ledger',
			'operations',
			'tokenTransfers',
			'transaction'
		]);
		expect(transactionDetail).not.toHaveBeenCalled();
		for (const query of [
			'view=typo',
			'view=typed&limit=201',
			'view=typed&limit=1&limit=2',
			'view=typed&unknown=1',
			'view=typed&ledger_sequence=1.5'
		])
			await request(app)
				.get('/v1/analytics/transactions/' + transactionHash + '?' + query)
				.expect(400);
		expect(transactionDetail).not.toHaveBeenCalled();
	});
	it('maps not-found to REST404 and nullable typed GraphQL, and validates hash-only input', async () => {
		const { app, transactionDetail } = await fixture();
		transactionDetail.mockResolvedValue(null);
		await request(app)
			.get('/v1/analytics/transactions/' + transactionHash + '?view=typed')
			.expect(404);
		const missing = await request(app)
			.post('/graphql')
			.send({
				query:
					'{hubbleTransaction(transactionHash:"' +
					transactionHash +
					'"){transaction{id}}}'
			})
			.expect(200);
		expect(missing.body.data.hubbleTransaction).toBeNull();
		const invalid = await request(app)
			.post('/graphql')
			.send({
				query: '{hubbleTransaction(transactionHash:"bad"){transaction{id}}}'
			})
			.expect(200);
		expect(invalid.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
	});
});
