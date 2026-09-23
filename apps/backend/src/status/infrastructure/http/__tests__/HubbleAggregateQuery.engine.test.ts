import { queryHubbleAggregate } from '../HubbleAggregateQuery.js';
import {
	catalog,
	dataset,
	input,
	records,
	batches
} from './fixtures/HubbleAggregateFixtures.js';
import type {
	HubbleSemanticQueryExecutor,
	HubblePreparedParameter
} from '../HubbleSemanticWarehouse.js';
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engine = endpoint ? describe : describe.skip;
engine('Hubble aggregate SQL against inline fixtures only', () => {
	const executor: HubbleSemanticQueryExecutor = {
		database: 'stellar_hubble',
		maximumRows: 1000,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			const query = sql
				.replaceAll(
					'`stellar_hubble`.`history_transactions`',
					'(' + records + ')'
				)
				.replaceAll('`stellar_hubble`._ingestion_batches', '(' + batches + ')');
			if (query.includes('`stellar_hubble`.'))
				throw new Error('Physical table reference remained in inline fixture');
			const url = new URL(endpoint!);
			url.searchParams.set('database', 'system');
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
			return JSON.parse(body) as { data: T[] };
		}
	};
	it('retains exact widened sums, excludes unpublished digests, and paginates numeric order', async () => {
		const page = await queryHubbleAggregate(executor, catalog, dataset, input);
		expect(page.rows).toEqual([
			{ kind: 'A', n: '2', total: '9232379236109516800' },
			{ kind: 'B', n: '1', total: '20' }
		]);
		expect(page.nextOffset).toBe(2);
		const next = await queryHubbleAggregate(executor, catalog, dataset, {
			...input,
			offset: 2
		});
		expect(next.rows).toEqual([
			{ kind: 'C', n: '1', total: '5' },
			{ kind: null, n: '1', total: null }
		]);
		expect(next.nextOffset).toBeNull();
	}, 20000);
	it('supports all six functions and excludes null distinct values', async () => {
		const page = await queryHubbleAggregate(executor, catalog, dataset, {
			...input,
			groupBy: [],
			orderBy: [],
			aggregations: [
				{ function: 'count', alias: 'n' },
				{ function: 'count_distinct', field: 'kind', alias: 'kinds' },
				{ function: 'avg', field: 'ratio', alias: 'mean' },
				{ function: 'min', field: 'kind', alias: 'first_kind' },
				{ function: 'max', field: 'amount', alias: 'max_amount' },
				{ function: 'count', field: 'amount', alias: 'with_amount' }
			]
		});
		expect(page.rows).toEqual([
			{
				n: '5',
				kinds: '3',
				mean: '0.95',
				first_kind: 'A',
				max_amount: '9223372036854775807',
				with_amount: '4'
			}
		]);
	}, 15000);
	it('empty matches return zero counts and null sum rather than invented data', async () => {
		const page = await queryHubbleAggregate(executor, catalog, dataset, {
			...input,
			groupBy: [],
			orderBy: [],
			filters: [{ field: 'kind', value: 'missing' }]
		});
		expect(page.rows).toEqual([{ n: '0', total: null }]);
	}, 15000);
	it('widens Decimal128 sums before accumulation and preserves declared scale', async () => {
		const decimalRecords = `SELECT * FROM values('kind Nullable(String),amount Nullable(Decimal(38,2)),ratio Float64,_ledger_sequence UInt32,_batch_id String,_source_sha256 String',
		 ('A','999999999999999999999999999999999999.99',0,10,'good','s1'),
		 ('A','999999999999999999999999999999999999.99',0,11,'good','s1'))`;
		const decimalExecutor: HubbleSemanticQueryExecutor = {
			...executor,
			execute: <T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) =>
				executor.execute<T>(
					sql.replaceAll(
						'`stellar_hubble`.`history_transactions`',
						'(' + decimalRecords + ')'
					),
					parameters
				)
		};
		for (const type of [
			'Nullable(Decimal(38, 2))',
			'Nullable(Decimal128(2))'
		]) {
			const page = await queryHubbleAggregate(
				decimalExecutor,
				catalog,
				{
					...dataset,
					columns: dataset.columns.map((column) =>
						column.name === 'amount' ? { ...column, type } : column
					)
				},
				input
			);
			expect(page.rows).toEqual([
				{ kind: 'A', n: '2', total: '1999999999999999999999999999999999999.98' }
			]);
			expect(page.aggregates?.[1]?.approximate).toBe(false);
		}
	}, 15000);
});
