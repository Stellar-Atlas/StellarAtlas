import {
	ClickHouseHubbleWarehouse,
	HubbleWarehouseInputError
} from '../HubbleWarehouseClient.js';

describe('ClickHouseHubbleWarehouse', () => {
	it('validates fields and emits one parameterized ClickHouse query', async () => {
		const requests: URL[] = [];
		const warehouse = new ClickHouseHubbleWarehouse({
			database: 'stellar_hubble',
			endpoint: 'http://127.0.0.1:18123',
			fetch: mockFetch(requests),
			password: 'secret',
			user: 'stellaratlas_api'
		});

		const result = await warehouse.query({
			dataset: 'history_transactions',
			filters: [
				{ field: 'id', operator: 'eq', value: 'transaction-1' },
				{ field: 'ledger_sequence', operator: 'gte', value: 3 }
			],
			limit: 25,
			orderBy: [{ direction: 'desc', field: 'ledger_sequence' }],
			select: ['id', 'ledger_sequence']
		});

		expect(result.rows).toEqual([{ id: 'transaction-1', ledger_sequence: 3 }]);
		const queryRequest = requests.find((request) =>
			request.searchParams
				.get('query')
				?.includes('FROM `stellar_hubble`.`history_transactions`')
		);
		expect(queryRequest).toBeDefined();
		expect(queryRequest?.searchParams.get('query')).toContain(
			'toString(`id`) = {filter_0:String}'
		);
		expect(queryRequest?.searchParams.get('query')).toContain(
			'`ledger_sequence` >= {filter_1:UInt32}'
		);
		expect(queryRequest?.searchParams.get('param_filter_0')).toBe(
			'transaction-1'
		);
		expect(queryRequest?.searchParams.get('param_filter_1')).toBe('3');
		expect(queryRequest?.searchParams.get('param_limit')).toBe('25');
		expect(
			queryRequest?.searchParams.get('output_format_json_quote_64bit_integers')
		).toBe('1');
	});

	it('rejects a column injection before issuing a data query', async () => {
		const requests: URL[] = [];
		const warehouse = new ClickHouseHubbleWarehouse({
			endpoint: 'http://127.0.0.1:18123',
			fetch: mockFetch(requests)
		});
		await expect(
			warehouse.query({
				dataset: 'history_transactions',
				select: ['id; DROP TABLE history_transactions']
			})
		).rejects.toBeInstanceOf(HubbleWarehouseInputError);
		expect(requests).toHaveLength(3);
	});

	it('queries official metadata columns whose names begin with an underscore', async () => {
		const requests: URL[] = [];
		const warehouse = new ClickHouseHubbleWarehouse({
			endpoint: 'http://127.0.0.1:18123',
			fetch: mockFetch(requests)
		});

		await expect(
			warehouse.query({
				dataset: 'history_transactions',
				limit: 1
			})
		).resolves.toMatchObject({ dataset: 'history_transactions' });
		expect(requests.at(-1)?.searchParams.get('query')).toContain('`_batch_id`');
	});
});

function mockFetch(requests: URL[]): typeof fetch {
	return (async (input: string | URL | Request): Promise<Response> => {
		const url =
			input instanceof URL
				? new URL(input)
				: typeof input === 'string'
					? new URL(input)
					: new URL(input.url);
		requests.push(url);
		const query = url.searchParams.get('query') ?? '';
		if (query.includes('FROM system.columns')) {
			return jsonResponse({
				data: [
					{
						name: 'id',
						position: 1,
						table: 'history_transactions',
						type: 'String'
					},
					{
						name: 'ledger_sequence',
						position: 2,
						table: 'history_transactions',
						type: 'UInt32'
					},
					{
						name: '_batch_id',
						position: 3,
						table: 'history_transactions',
						type: 'UUID'
					}
				]
			});
		}
		if (query.includes('FROM system.parts')) {
			return jsonResponse({
				data: [{ rows: '1', table: 'history_transactions' }]
			});
		}
		if (query.includes('._ingestion_batches FINAL')) {
			return jsonResponse({
				data: [
					{
						completed_batches: '2',
						failed_batches: '0',
						maximum_ledger: '66',
						minimum_ledger: '2',
						started_batches: '0',
						total_rows: '87'
					}
				]
			});
		}
		if (query.includes('history_transactions')) {
			return jsonResponse({
				data: [{ id: 'transaction-1', ledger_sequence: 3 }]
			});
		}
		return new Response('unexpected query', { status: 500 });
	}) as typeof fetch;
}

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { 'Content-Type': 'application/json' },
		status: 200
	});
}
