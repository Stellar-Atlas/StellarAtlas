import {
	decodeContractEventValue,
	type ContractEventValue
} from '../contract-event-value';

describe('decodeContractEventValue', () => {
	it('keeps typed objects, nested arrays, full address strings, and exact integer tokens', () => {
		const value = decodeContractEventValue(
			'[{"symbol":"REDSTONE"},{"address":"CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA"},{"u256":"170141183460469231731687303715884105727"}]'
		);
		expect(value).toEqual({
			kind: 'array',
			label: null,
			items: [
				{
					kind: 'typed',
					label: '[0]',
					typeName: 'symbol',
					value: { kind: 'string', label: 'symbol', value: 'REDSTONE' }
				},
				{
					kind: 'typed',
					label: '[1]',
					typeName: 'address',
					value: { kind: 'string', label: 'address', value: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA' }
				},
				{
					kind: 'typed',
					label: '[2]',
					typeName: 'u256',
					value: { kind: 'string', label: 'u256', value: '170141183460469231731687303715884105727' }
				}
			]
		});
	});

	it('normalizes exact nested ScVal map and vector wrappers without guessing field meaning', () => {
		const value = decodeContractEventValue(
			'{"map":[{"key":{"symbol":"updated_feeds"},"val":{"vec":[{"map":[{"key":{"symbol":"package_timestamp"},"val":{"u64":"1791674220000"}},{"key":{"symbol":"price"},"val":{"u256":"99992609"}}]}]}},{"key":{"symbol":"updater"},"val":{"address":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"}}]}'
		);
		expect(value).toMatchObject({
			kind: 'object',
			entries: [
				{
					label: 'updated_feeds',
					key: { kind: 'typed', typeName: 'symbol' },
					value: {
						kind: 'array',
						items: [
							{
								kind: 'object',
								entries: [
									{ label: 'package_timestamp', value: { kind: 'typed', typeName: 'u64', value: { kind: 'string', value: '1791674220000' } } },
									{ label: 'price', value: { kind: 'typed', typeName: 'u256', value: { kind: 'string', value: '99992609' } } }
								]
							}
						]
					}
				},
				{
					label: 'updater',
					value: {
						kind: 'typed',
						typeName: 'address',
						value: { kind: 'string', value: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' }
					}
				}
			]
		});
		const unknownMapShape = decodeContractEventValue(
			'{"map":[{"key":{"symbol":"x"},"val":{"u64":"1"},"extra":true}]}'
		);
		if (unknownMapShape.kind !== 'object') throw new Error('Expected object');
		const preservedMap = unknownMapShape.entries[0]?.value;
		if (preservedMap?.kind !== 'array') throw new Error('Expected preserved map array');
		const preservedEntry = preservedMap.items[0];
		if (preservedEntry?.kind !== 'object') throw new Error('Expected preserved entry');
		expect(preservedEntry.entries).toHaveLength(3);
		expect(preservedEntry.entries.find((entry) => entry.label === 'extra')?.value).toEqual({
			kind: 'boolean',
			label: 'extra',
			value: true
		});
	});

	it('decodes bytes as text only when UTF-8 is valid and printable', () => {
		expect(decodeContractEventValue('{"bytes":"48656c6c6f0a5354454c4c4152"}')).toEqual({
			kind: 'bytes',
			label: null,
			hex: '48656c6c6f0a5354454c4c4152',
			encoding: 'utf-8',
			text: 'Hello\nSTELLAR'
		});
		const binary = decodeContractEventValue('{"bytes":"ff0001"}');
		expect(binary).toMatchObject({
			kind: 'bytes',
			hex: 'ff0001',
			encoding: 'hex'
		});
		expect(binary).not.toHaveProperty('text');
		expect(decodeContractEventValue('{"bytes":"e280ae"}')).toMatchObject({
			kind: 'bytes',
			encoding: 'hex'
		});
	});

	it('keeps original bytes when a verified embedded decoder is supplied', () => {
		const value = decodeContractEventValue('{"bytes":"00ff"}', {
			interpretBytes: (bytes): ContractEventValue => ({
				kind: 'number',
				label: null,
				value: String(bytes.length)
			})
		});
		expect(value).toMatchObject({
			kind: 'bytes',
			hex: '00ff',
			encoding: 'hex',
			interpretation: {
				label: 'Embedded XDR interpretation',
				value: { kind: 'number', value: '2' }
			}
		});
	});

	it('preserves unknown fields and returns explicit raw fallback for malformed JSON', () => {
		const value = decodeContractEventValue('{"unknown":{"nested":[true,null]}}');
		expect(value).toMatchObject({
			kind: 'object',
			entries: [
				{
					label: 'unknown',
					value: {
						kind: 'object',
						entries: [
							{
								label: 'nested',
								value: {
									kind: 'array',
									items: [
										{ kind: 'boolean', value: true },
										{ kind: 'null' }
									]
								}
							}
						]
					}
				}
			]
		});
		expect(decodeContractEventValue('<img src=x onerror=alert(1)>')).toEqual({
			kind: 'raw',
			label: null,
			text: '<img src=x onerror=alert(1)>',
			reason: 'invalid-json'
		});
	});

	it('falls back when nesting or node limits are exceeded', () => {
		expect(decodeContractEventValue('[[[0]]]', { maxDepth: 1 })).toMatchObject({
			kind: 'raw',
			reason: 'limit-exceeded'
		});
		expect(decodeContractEventValue('[0,1]', { maxNodes: 2 })).toMatchObject({
			kind: 'raw',
			reason: 'limit-exceeded'
		});
		expect(decodeContractEventValue({ nested: { value: true } }, { maxDepth: 1 })).toMatchObject({
			kind: 'raw',
			reason: 'limit-exceeded'
		});
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(decodeContractEventValue(cyclic)).toMatchObject({
			kind: 'raw',
			reason: 'limit-exceeded'
		});
		expect(decodeContractEventValue(Number.MAX_SAFE_INTEGER + 1)).toMatchObject({
			kind: 'raw',
			reason: 'unsupported-value'
		});
	});
});
