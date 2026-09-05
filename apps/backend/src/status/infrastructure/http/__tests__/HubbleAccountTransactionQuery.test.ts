import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';
import { queryHubbleAccountTransactions } from '../HubbleAccountTransactionQuery.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

describe('queryHubbleAccountTransactions', () => {
	it('keeps source and effect lookups in separate indexable branches', async () => {
		let capturedSql = '';
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				_parameters: readonly HubblePreparedParameter[]
			): Promise<{ readonly data: readonly T[] }> {
				capturedSql = sql;
				return { data: [] };
			}
		};

		await queryHubbleAccountTransactions(executor, {
			account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
			limit: 1
		});

		expect(capturedSql).toContain('UNION ALL');
		expect(capturedSql).toContain('WHERE account = {account:String}');
		expect(capturedSql).toContain('WHERE account != {account:String}');
		expect(capturedSql).not.toContain('OR id IN');
		expect(
			capturedSql.split(completedHubbleBatchPredicate('stellar_hubble'))
		).toHaveLength(5);
		expect(capturedSql).toContain(
			'LIMIT {row_limit:UInt32} OFFSET {offset:UInt64}'
		);
	});
});
