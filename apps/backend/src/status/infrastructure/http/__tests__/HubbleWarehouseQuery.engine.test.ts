import { buildFilter } from '../HubbleWarehouseQuery.js';
import type {
	HubbleColumn,
	HubbleFilter
} from '../HubbleWarehouseContracts.js';
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;
engineTest(
	'native String filter compatibility on inline ClickHouse fixtures',
	() => {
		it('preserves nullable, exact-string, IN and existing FixedString semantics', async () => {
			const fixture =
				"SELECT * FROM values('id UInt8, value String, optional Nullable(String), fixed FixedString(4)',(1,'001','001','A'),(2,'9007199254740993',NULL,'B'),(3,'0001','0001','A'))";
			async function ids(
				type: string,
				field: string,
				filter: HubbleFilter,
				legacy = false
			): Promise<unknown> {
				const columns = new Map<string, HubbleColumn>([
					[field, { name: field, type, position: 1 }]
				]);
				const parameters: { name: string; type: string; value: string }[] = [];
				let predicate = buildFilter(
					columns,
					{ ...filter, field },
					0,
					parameters
				);
				if (legacy && type !== 'FixedString(4)')
					predicate = predicate.replaceAll(
						'`' + field + '`',
						'toString(`' + field + '`)'
					);
				const url = new URL(endpoint!);
				url.searchParams.set(
					'query',
					'SELECT id FROM (' +
						fixture +
						') WHERE ' +
						predicate +
						' ORDER BY id FORMAT JSON'
				);
				for (const parameter of parameters)
					url.searchParams.set('param_' + parameter.name, parameter.value);
				const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
				const response = await fetch(url, {
					method: 'POST',
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
						: {},
					signal: AbortSignal.timeout(15000)
				});
				const body = await response.text();
				if (!response.ok)
					throw new Error('Inline String filter fixture failed: ' + body);
				return (JSON.parse(body) as { data: unknown }).data;
			}
			expect(
				await ids('String', 'value', {
					field: 'value',
					value: '9007199254740993'
				})
			).toEqual([{ id: 2 }]);
			expect(
				await ids('String', 'value', {
					field: 'value',
					operator: 'in',
					values: ['001', '9007199254740993']
				})
			).toEqual([{ id: 1 }, { id: 2 }]);
			expect(
				await ids('Nullable(String)', 'optional', {
					field: 'optional',
					value: '001'
				})
			).toEqual([{ id: 1 }]);
			expect(
				await ids('Nullable(String)', 'optional', {
					field: 'optional',
					operator: 'is_null'
				})
			).toEqual([{ id: 2 }]);
			for (const [type, field, value] of [
				['String', 'value', '001'],
				['Nullable(String)', 'optional', '0001'],
				['FixedString(4)', 'fixed', 'A']
			] as const)
				expect(await ids(type, field, { field, value })).toEqual(
					await ids(type, field, { field, value }, true)
				);
		}, 45000);
	}
);
