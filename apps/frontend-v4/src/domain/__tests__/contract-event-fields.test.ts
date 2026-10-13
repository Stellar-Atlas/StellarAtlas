import { decodeContractEventValue } from '../contract-event-value';
import { flattenContractEventValue } from '../contract-event-fields';

describe('flattenContractEventValue', () => {
	it('flattens generic nested maps and vectors into readable paths and typed leaves', () => {
		const value = decodeContractEventValue(
			'{"updated_feeds":[{"package_timestamp":{"u64":"1791674220000"},"price":{"u256":"99992609"}}],"updater":{"address":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"}}'
		);
		const result = flattenContractEventValue(value);
		expect(result.truncated).toBe(false);
		expect(result.fields.map(({ path, type }) => [path, type])).toEqual([
			['updated_feeds[0].package_timestamp', 'u64'],
			['updated_feeds[0].price', 'u256'],
			['updater', 'address']
		]);
		expect(result.fields[0]?.value).toMatchObject({ kind: 'string', value: '1791674220000' });
		expect(result.fields[1]?.value).toMatchObject({ kind: 'string', value: '99992609' });
		expect(result.fields[2]?.value).toMatchObject({ kind: 'string', value: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' });
	});

	it('preserves full keys, exact integers, and array positions without semantic guesses', () => {
		const value = decodeContractEventValue(
			'{"map":[{"key":{"symbol":"a long full key"},"val":{"i256":"-170141183460469231731687303715884105727"}},{"key":{"symbol":"other"},"val":{"vec":[{"string":"full address-like text"}]}}]}'
		);
		const result = flattenContractEventValue(value);
		expect(result.fields.map(({ path, type }) => [path, type])).toEqual([
			['a long full key', 'i256'],
			['other[0]', 'string']
		]);
		expect(result.fields[0]?.value).toMatchObject({ value: '-170141183460469231731687303715884105727' });
	});

	it('keeps empty containers and non-JSON leaves as visible values', () => {
		const value = decodeContractEventValue('{"empty_map":{},"empty_list":[],"raw":"void"}');
		const result = flattenContractEventValue(value);
		expect(result.fields.map(({ path, type }) => [path, type])).toEqual([
			['empty_map', 'object'],
			['empty_list', 'array'],
			['raw', 'string']
		]);
	});

	it("does not reset paths for a nested literal Value key", () => {
		const value = decodeContractEventValue("{\"Value\":{\"x\":1}}");
		expect(flattenContractEventValue(value).fields.map((field) => field.path)).toEqual(["Value.x"]);
	});

	it("labels nonscalar map keys explicitly instead of hiding them", () => {
		const value = decodeContractEventValue("{\"map\":[{\"key\":{\"vec\":[{\"u32\":\"1\"}]},\"val\":{\"u32\":\"2\"}}]}");
		expect(flattenContractEventValue(value).fields[0]?.path).toBe("[unknown map key · entry 0]");
	});

	it('reports truncation instead of silently dropping values beyond the limit', () => {
		const value = decodeContractEventValue('{"a":1,"b":2,"c":3}');
		const result = flattenContractEventValue(value, 2);
		expect(result.fields).toHaveLength(2);
		expect(result.truncated).toBe(true);
	});

	it('retains raw malformed input as a visible leaf', () => {
		const result = flattenContractEventValue(decodeContractEventValue('<raw>'));
		expect(result.fields).toEqual([
			{ path: 'Value', type: 'raw', value: { kind: 'raw', label: null, text: '<raw>', reason: 'invalid-json' } }
		]);
		expect(result.truncated).toBe(false);
	});
});
