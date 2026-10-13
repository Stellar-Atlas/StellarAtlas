import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { hubbleAssetReportResolvers } from '../HubbleAssetReportGraphql.js';

describe('asset report GraphQL executor boundary', () => {
	it('invokes the warehouse executor with its owning warehouse as this', async () => {
		let queryCount = 0;
		const execute = jest.fn(async <T>(_sql: string) => ({
			data: (++queryCount === 1
				? [{ ranges: [['2', '10']], range_count: '1' }]
				: []) as T[]
		}));
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 10_000,
			execute
		};
		const warehouse = {
			executor,
			readModelExecutor(this: { executor: HubbleSemanticQueryExecutor }) {
				if (this.executor !== executor) throw new Error('lost warehouse receiver');
				return this.executor;
			}
		} as unknown as HubbleWarehouse;
		const resolvers = hubbleAssetReportResolvers(warehouse, (error) =>
			error instanceof Error ? error : new Error(String(error))
		);

		const result = await resolvers.hubbleAssetBalanceHistory({
			asset: 'USD:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
		});

		expect(execute).toHaveBeenCalledTimes(2);
		expect(result.data).toEqual([]);
	});
});
