import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { withHubbleTransactionLedgerHints } from '../HubbleTransactionLedgerHints.js';
import { queryHubbleTransactionDetail } from '../HubbleTransactionQuery.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import type { HubbleTransactionDetail } from '../HubbleTransactionContracts.js';
import {
	queryFixture,
	transactionHash,
	transactionLedger
} from './HubbleTransactionFixture.js';

describe('optional shared transaction ledger hints', () => {
	let page: HubbleTransactionDetail;
	beforeAll(async () => {
		const result = await queryHubbleTransactionDetail(queryFixture().executor, {
			transactionHash,
			limit: 1
		});
		if (result === null) throw new Error('Expected typed fixture');
		page = result;
	});
	function fixture() {
		const warehouse = mock<HubbleWarehouse>();
		warehouse.transactionDetail.mockResolvedValue(page);
		const locate = jest
			.fn<Promise<number | null>, [string]>()
			.mockResolvedValue(transactionLedger);
		return {
			warehouse,
			locate,
			service: withHubbleTransactionLedgerHints(warehouse, locate)
		};
	}
	it('uses an indexed hint but returns only the same parsed warehouse detail', async () => {
		const { warehouse, locate, service } = fixture();
		expect(
			await service.transactionDetail({
				transactionHash: transactionHash.toUpperCase(),
				limit: 1
			})
		).toBe(page);
		expect(locate).toHaveBeenCalledWith(transactionHash);
		expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
		expect(warehouse.transactionDetail).toHaveBeenCalledWith({
			transactionHash,
			ledgerSequence: transactionLedger,
			limit: 1
		});
	});
	it.each([null, 0, -1, 1.5, Number.NaN, 2147483648])(
		'falls back when the locator has no usable ledger (%s)',
		async (hint) => {
			const { warehouse, locate, service } = fixture();
			locate.mockResolvedValue(hint);
			expect(
				await service.transactionDetail({ transactionHash, limit: 1 })
			).toBe(page);
			expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
			expect(warehouse.transactionDetail).toHaveBeenCalledWith({
				transactionHash,
				limit: 1
			});
		}
	);
	it('a failed locator is not a gate to a parsed-only transaction', async () => {
		const { warehouse, locate, service } = fixture();
		locate.mockRejectedValue(new Error('statement timeout'));
		expect(await service.transactionDetail({ transactionHash, limit: 1 })).toBe(
			page
		);
		expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
		expect(warehouse.transactionDetail).toHaveBeenCalledWith({
			transactionHash,
			limit: 1
		});
	});
	it('retries without an inferred ledger when a stale hint finds no parsed row', async () => {
		const { warehouse, locate, service } = fixture();
		locate.mockResolvedValue(transactionLedger - 1);
		warehouse.transactionDetail
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(page);
		expect(await service.transactionDetail({ transactionHash, limit: 1 })).toBe(
			page
		);
		expect(warehouse.transactionDetail.mock.calls).toEqual([
			[{ transactionHash, ledgerSequence: transactionLedger - 1, limit: 1 }],
			[{ transactionHash, limit: 1 }]
		]);
	});
	it('does not alter an explicit caller ledger or its relation cursors', async () => {
		const { warehouse, locate, service } = fixture();
		const input = {
			transactionHash,
			ledgerSequence: transactionLedger,
			limit: 1,
			effectsAfter: page.effects.nextCursor!
		};
		expect(await service.transactionDetail(input)).toBe(page);
		expect(locate).not.toHaveBeenCalled();
		expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
		expect(warehouse.transactionDetail).toHaveBeenCalledWith(input);
	});
	it('rejects invalid input before metadata access and never accepts a different parsed hash', async () => {
		const { warehouse, locate, service } = fixture();
		await expect(
			service.transactionDetail({ transactionHash: 'not-a-hash' })
		).rejects.toThrow('transactionHash');
		expect(locate).not.toHaveBeenCalled();
		warehouse.transactionDetail.mockResolvedValue({
			...page,
			transaction: { ...page.transaction, hash: 'f'.repeat(64) }
		});
		await expect(
			service.transactionDetail({ transactionHash })
		).rejects.toThrow('identity');
		expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
	});
	it('does not reinterpret a parsed warehouse error as a missing optional hint', async () => {
		const { warehouse, service } = fixture();
		warehouse.transactionDetail.mockRejectedValue(
			new Error('parsed query failed')
		);
		await expect(
			service.transactionDetail({ transactionHash })
		).rejects.toThrow('parsed query failed');
		expect(warehouse.transactionDetail).toHaveBeenCalledTimes(1);
	});
	it('shares the same hash-only optimization across REST and GraphQL', async () => {
		const { warehouse, service } = fixture();
		const app = express();
		app.use(express.json());
		app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse: service }));
		app.all('/graphql', hubbleWarehouseGraphqlHandler(service));
		const rest = await request(app)
			.get(
				'/v1/analytics/transactions/' + transactionHash + '?view=typed&limit=1'
			)
			.expect(200);
		const graphql = await request(app)
			.post('/graphql')
			.send({
				query:
					'query($hash:String!){hubbleTransaction(transactionHash:$hash,limit:1){transaction{hash ledgerSequence} operations{items{id}} events{items{id}}}}',
				variables: { hash: transactionHash }
			})
			.expect(200);
		expect(graphql.body.errors).toBeUndefined();
		expect(graphql.body.data.hubbleTransaction.transaction).toEqual({
			hash: transactionHash,
			ledgerSequence: transactionLedger
		});
		expect(rest.body.transaction.hash).toBe(transactionHash);
		expect(warehouse.transactionDetail.mock.calls[0]).toEqual(
			warehouse.transactionDetail.mock.calls[1]
		);
		expect(warehouse.transactionDetail.mock.calls[0]![0].ledgerSequence).toBe(
			transactionLedger
		);
	});
});
