import { queryHubbleAssetHolders } from '../HubbleAssetHolderQuery.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;

engineTest('holder aggregation against ClickHouse inline fixtures', () => {
	const source = `SELECT * FROM values(
 'account_id String, balance Float64, buying_liabilities Float64, selling_liabilities Float64, last_modified_ledger UInt32, ledger_sequence UInt32, deleted Bool, _row_number UInt32, _ingested_at UInt32, _batch_id String, _source_sha256 String, asset_code String, asset_issuer String, asset_type String, trust_line_limit Int64, flags UInt32',
 ('GA',1,0,0,10,10,false,1,10,'b1','s1','USD','GISSUER','credit_alphanum4',100,1),
 ('GA',7,2,3,20,20,false,1,20,'b2','s2','USD','GISSUER','credit_alphanum4',200,2),
 ('GA',999,0,0,30,30,false,1,30,'b3','s3','USD','GISSUER','credit_alphanum4',999,3),
 ('GB',5,0,0,10,10,false,2,10,'b1','s1','USD','GISSUER','credit_alphanum4',100,1),
 ('GB',5,0,0,20,20,true,2,20,'b2','s2','USD','GISSUER','credit_alphanum4',100,1),
 ('GC',0,0,0,20,20,false,3,20,'b2','s2','USD','GISSUER','credit_alphanum4',100,1),
 ('GD',8,0,0,20,20,false,4,20,'b2','s2','USD','GISSUER','credit_alphanum4',100,1))`;
	const batches = `SELECT * FROM values(
 'batch_id String, source_sha256 String, status String, updated_at UInt32',
 ('b1','s1','complete',10),('b2','s2','complete',20),('b3','s3','failed',30))`;
	const executor: HubbleSemanticQueryExecutor = {
		database: 'stellar_hubble',
		maximumRows: 100,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			const query = sql
				.replaceAll('`stellar_hubble`.accounts', '(' + source + ')')
				.replaceAll('`stellar_hubble`.trustlines', '(' + source + ')')
				.replaceAll('`stellar_hubble`._ingestion_batches', '(' + batches + ')');
			const url = new URL(endpoint!);
			url.searchParams.set('query', query);
			for (const p of parameters)
				url.searchParams.set('param_' + p.name, p.value);
			const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
			const response = await fetch(url, {
				method: 'POST',
				signal: AbortSignal.timeout(10000),
				headers: user
					? {
							Authorization:
								'Basic ' +
								Buffer.from(
									user +
										':' +
										(process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
								).toString('base64')
						}
					: {}
			});
			const body = await response.text();
			if (!response.ok) throw new Error(body);
			return JSON.parse(body) as { data: readonly T[] };
		}
	};
	const catalog = {
		coverage: summarizeHubbleLedgerCoverage([]),
		generatedAt: '2026-09-07T00:00:00.000Z'
	};
	it.each([
		{ type: 'native' } as const,
		{ type: 'issued', code: 'USD', issuer: 'GISSUER' } as const
	])(
		'selects published latest $type balances without alias substitution and paginates',
		async (asset) => {
			const page = await queryHubbleAssetHolders(
				executor,
				{ asset, limit: 1 },
				catalog
			);
			expect(page.holders).toEqual([
				expect.objectContaining({
					account_id: 'GA',
					balance: 7,
					buying_liabilities: 2,
					selling_liabilities: 3,
					ledger_sequence: 20,
					last_modified_ledger: 20
				})
			]);
			expect(page.nextCursor).toBe('GA');
			const next = await queryHubbleAssetHolders(
				executor,
				{ asset, limit: 1, after: page.nextCursor! },
				catalog
			);
			expect(next.holders).toEqual([
				expect.objectContaining({ account_id: 'GD', balance: 8 })
			]);
			expect(next.nextCursor).toBeNull();
			const deleted = await queryHubbleAssetHolders(
				executor,
				{ asset, account: 'GB' },
				catalog
			);
			expect(deleted.holders).toEqual([]);
		},
		30000
	);
});
