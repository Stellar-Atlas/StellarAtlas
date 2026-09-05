import { queryHubbleAssetHolders } from '../HubbleAssetHolderQuery.js';
import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';
import type {
	HubbleAssetHolderQuery,
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

describe('queryHubbleAssetHolders publication', () => {
	it.each<HubbleAssetHolderQuery['asset']>([
		{ type: 'native' },
		{ type: 'issued', code: 'USD', issuer: 'GISSUER' }
	])(
		'gates $type observations before latest-balance aggregation and keeps keyset pagination',
		async (asset) => {
			let capturedSql = '';
			let capturedParameters: readonly HubblePreparedParameter[] = [];
			const executor: HubbleSemanticQueryExecutor = {
				database: 'stellar_hubble',
				maximumRows: 200,
				async execute<T>(
					sql: string,
					parameters: readonly HubblePreparedParameter[]
				) {
					capturedSql = sql;
					capturedParameters = parameters;
					return {
						data: [
							{ account_id: 'GB', balance: 2 },
							{ account_id: 'GC', balance: 3 }
						] as unknown as readonly T[]
					};
				}
			};
			const page = await queryHubbleAssetHolders(executor, {
				asset,
				after: 'GA',
				limit: 1
			});
			const predicate = completedHubbleBatchPredicate('stellar_hubble');
			expect(capturedSql).toContain(predicate);
			expect(capturedSql.indexOf(predicate)).toBeLessThan(
				capturedSql.indexOf('GROUP BY account_id')
			);
			expect(capturedSql).toContain('AND account_id > {after:String}');
			expect(capturedSql).toContain('WHERE deleted = false AND balance > 0');
			expect(capturedParameters).toContainEqual({
				name: 'row_limit',
				type: 'UInt32',
				value: '2'
			});
			expect(page.holders).toEqual([{ account_id: 'GB', balance: 2 }]);
			expect(page.nextCursor).toBe('GB');
		}
	);
});
