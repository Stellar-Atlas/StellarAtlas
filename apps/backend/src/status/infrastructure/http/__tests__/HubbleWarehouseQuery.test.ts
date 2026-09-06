import { buildFilter } from '../HubbleWarehouseQuery.js';
import type {
	HubbleColumn,
	HubbleFilter
} from '../HubbleWarehouseContracts.js';
function prepared(type: string, filter: HubbleFilter) {
	const columns = new Map<string, HubbleColumn>([
		['value', { name: 'value', type, position: 1 }]
	]);
	const parameters: { name: string; type: string; value: string }[] = [];
	return { sql: buildFilter(columns, filter, 0, parameters), parameters };
}
describe('index-preserving native String filters', () => {
	it.each([
		'String',
		'Nullable(String)',
		'LowCardinality(String)',
		'LowCardinality(Nullable(String))'
	])('keeps %s equality native and values exact', (type) => {
		const value = "001'\\9007199254740993";
		expect(prepared(type, { field: 'value', operator: 'eq', value })).toEqual({
			sql: '`value` = {filter_0:String}',
			parameters: [{ name: 'filter_0', type: 'String', value }]
		});
	});
	it.each(['String', 'Nullable(String)', 'LowCardinality(String)'])(
		'keeps %s IN native without interpolating or rounding values',
		(type) => {
			const values = ['0001', '9007199254740993', "a'b"];
			expect(
				prepared(type, { field: 'value', operator: 'in', values })
			).toEqual({
				sql: '`value` IN ({filter_0_0:String}, {filter_0_1:String}, {filter_0_2:String})',
				parameters: values.map((value, index) => ({
					name: 'filter_0_' + index,
					type: 'String',
					value
				}))
			});
		}
	);
	it.each([
		'FixedString(64)',
		'Nullable(FixedString(64))',
		'Dynamic',
		'JSON',
		'Array(String)'
	])('preserves existing %s casting semantics', (type) => {
		expect(prepared(type, { field: 'value', value: '001' }).sql).toBe(
			'toString(`value`) = {filter_0:String}'
		);
		expect(
			prepared(type, { field: 'value', operator: 'in', values: ['001'] }).sql
		).toBe('toString(`value`) IN ({filter_0_0:String})');
	});
	it('leaves null and exact integer handling unchanged', () => {
		expect(
			prepared('Nullable(String)', { field: 'value', operator: 'is_null' })
		).toEqual({ sql: 'isNull(`value`)', parameters: [] });
		expect(
			prepared('Int64', { field: 'value', value: '9007199254740993' })
		).toEqual({
			sql: '`value` = {filter_0:Int64}',
			parameters: [
				{ name: 'filter_0', type: 'Int64', value: '9007199254740993' }
			]
		});
	});
});
