import { queryHubbleAggregate } from '../HubbleAggregateQuery.js';
import { parseHubbleAggregateFields } from '../HubbleAggregateValidation.js';
import { catalog, dataset, input } from './fixtures/HubbleAggregateFixtures.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
import type { HubbleQuery } from '../HubbleWarehouseContracts.js';
function executor() {
	const calls: {
		sql: string;
		parameters: readonly HubblePreparedParameter[];
	}[] = [];
	const value: HubbleSemanticQueryExecutor = {
		database: 'stellar_hubble',
		maximumRows: 1000,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			calls.push({ sql, parameters });
			return {
				data: [
					{ __value_0: 'A', __value_1: '2', __value_2: '9232379236109516800' },
					{ __value_0: 'B', __value_1: '1', __value_2: '20' },
					{ __value_0: 'C', __value_1: '1', __value_2: '5' }
				] as T[]
			};
		}
	};
	return { value, calls };
}
describe('shared bounded Hubble aggregates', () => {
	it('compiles one parameterized, digest-gated query with numeric order and exact sum', async () => {
		const e = executor();
		const result = await queryHubbleAggregate(e.value, catalog, dataset, {
			...input,
			filters: [{ field: 'kind', value: "x'; DROP TABLE t; --" }]
		});
		expect(e.calls).toHaveLength(1);
		const { sql, parameters } = e.calls[0]!;
		expect(sql).toContain('sumOrNull(toDecimal128(`amount`, 0)) AS __metric_1');
		expect(sql).toContain('ORDER BY __metric_1 DESC, __group_0 ASC');
		expect(sql).toContain(
			"tupleElement(argMax(tuple(status, source_sha256), updated_at), 1) = 'complete'"
		);
		expect(sql).not.toContain('DROP TABLE');
		expect(parameters).toContainEqual({
			name: 'filter_0',
			type: 'String',
			value: "x'; DROP TABLE t; --"
		});
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]).toEqual({
			kind: 'A',
			n: '2',
			total: '9232379236109516800'
		});
		expect(result.nextOffset).toBe(2);
		expect(result.coverageStatus).toBe('complete');
		expect(result.aggregates?.[1]).toMatchObject({
			sourceType: 'Nullable(Int64)',
			approximate: false,
			valueEncoding: 'string-or-null'
		});
	});
	it('labels float and average outputs as approximate and partial coverage honestly', async () => {
		const e = executor();
		const result = await queryHubbleAggregate(e.value, catalog, dataset, {
			...input,
			maxLedger: 200,
			orderBy: [],
			aggregations: [
				{ function: 'avg', field: 'amount', alias: 'mean' },
				{ function: 'sum', field: 'ratio', alias: 'total_ratio' }
			]
		});
		expect(result.coverageStatus).toBe('partial_or_unknown');
		expect(result.aggregates?.every((column) => column.approximate)).toBe(true);
		expect(result.semantics).toContain('not snapshot-pinned');
	});
	it.each([
		undefined,
		null,
		{},
		[null],
		[{}],
		[{ __value_0: 'A', __value_1: 1, __value_2: '2' }]
	])(
		'rejects malformed aggregate results instead of an empty success: %j',
		async (data) => {
			const e = executor();
			e.value.execute = async <T>() => ({ data: data as readonly T[] });
			await expect(
				queryHubbleAggregate(e.value, catalog, dataset, input)
			).rejects.toThrow('Invalid or incomplete aggregate warehouse response');
		}
	);
	it.each([
		'Decimal(39, 0)',
		'Decimal(76, 18)',
		'Decimal(12, 13)',
		'Decimal128(39)'
	])('rejects unsupported decimal precision/scale: %s', async (type) => {
		const e = executor();
		const decimalDataset = {
			...dataset,
			columns: dataset.columns.map((column) =>
				column.name === 'amount' ? { ...column, type } : column
			)
		};
		await expect(
			queryHubbleAggregate(e.value, catalog, decimalDataset, input)
		).rejects.toThrow('Decimal aggregates support');
		expect(e.calls).toHaveLength(0);
	});
	it.each([
		{ minLedger: undefined },
		{ maxLedger: undefined },
		{ minLedger: 101, maxLedger: 100 },
		{ minLedger: 1, maxLedger: 1000001 },
		{ limit: 0 },
		{ offset: 10001 },
		{ aggregations: [] },
		{ aggregations: [{ function: 'sum', alias: 'total' }] },
		{ aggregations: [{ function: 'sum', field: 'kind', alias: 'total' }] },
		{ aggregations: [{ function: 'count', alias: 'kind' }] },
		{ aggregations: [{ function: 'count', alias: 'n;DROP' }] },
		{ groupBy: ['kind', 'kind'] },
		{ groupBy: ['bad'] },
		{ orderBy: [{ field: 'amount' }] },
		{ select: ['kind'] },
		{ distinct: true },
		{
			aggregations: Array.from({ length: 17 }, (_, i) => ({
				function: 'count',
				alias: 'n' + i
			}))
		}
	])('rejects invalid query before executing: %j', async (patch) => {
		const e = executor();
		await expect(
			queryHubbleAggregate(e.value, catalog, dataset, {
				...input,
				...patch
			} as HubbleQuery)
		).rejects.toThrow();
		expect(e.calls).toHaveLength(0);
	});
	it('parses the shared aggregate fields without allowing SQL fragments or silent options', () => {
		expect(
			parseHubbleAggregateFields(input as unknown as Record<string, unknown>)
		).toMatchObject({
			minLedger: 2,
			maxLedger: 100,
			groupBy: ['kind'],
			aggregations: input.aggregations
		});
		expect(() =>
			parseHubbleAggregateFields({
				aggregations: [{ function: 'count', alias: 'n', sql: 'bad' }]
			})
		).toThrow('Unknown aggregate property');
		expect(() =>
			parseHubbleAggregateFields({
				aggregations: [{ function: 'arbitrary', alias: 'n' }]
			})
		).toThrow('Unsupported');
	});
});
