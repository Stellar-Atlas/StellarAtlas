import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decodeContractEventValue } from '../../../domain/contract-event-value';
import { formatContractEventNumber } from '../../../domain/contract-event-number';

jest.unstable_mockModule('../explorer-contract-event-table.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ScalarValue } = await import('../explorer-contract-event-table');
const { ExplorerOperationCall } = await import('../explorer-operation-call');
const ga = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contract = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
const render = (source: string, field = '') => renderToStaticMarkup(createElement(ScalarValue, { value: decodeContractEventValue(source), field }));

it.each([
	['{"string":"000001"}', '000001'], ['{"symbol":"00123"}', '00123'], ['"1234567"', '1234567'],
	['0.0000000000000000001', '0.0000000000000000001'], ['1e-7', '0.0000001'],
	['1234567.123456789012345678901', '1,234,567.123456789012345678901'],
	['{"u128":"170141183460469231731687303715884105727"}', '170,141,183,460,469,231,731,687,303,715,884,105,727']
])('preserves the meaning of scalar %s', (source, expected) => {
	expect(render(source)).toContain('>' + expected + '<');
});

it('carries flattened ScVal type into actual operation arguments without changing references', () => {
	const html = renderToStaticMarkup(createElement(ExplorerOperationCall, { filters: {}, row: {
		type: 'invoke_host_function', details: { type: 'invoke_contract', parameters_json_decoded: [
			{ address: contract }, { symbol: 'inspect' }, { string: '000001' }, { symbol: '00123' }, { u64: '1234567890123456789' }, { address: ga }
		] }
	} }));
	expect(html).toContain('<code>000001</code>'); expect(html).toContain('<code>00123</code>');
	expect(html).toContain('<code>1,234,567,890,123,456,789</code>');
	expect(html).toContain('href="/explorer/accounts/' + ga + '"');
	expect(html).toContain('/explorer/contracts/' + contract);
});

it('retains explicit field-date interpretation, full references and escaped text', () => {
	expect(render('"1767225600000"', 'package_timestamp')).toContain('dateTime="2026-01-01T00:00:00.000Z"');
	expect(render(JSON.stringify({ address: ga }))).toContain('href="/explorer/accounts/' + ga + '"');
	expect(render('{"string":"<script>0001</script>"}')).toContain('&lt;script&gt;0001&lt;/script&gt;');
});

it('bounds numeric expansion and preserves unsupported or oversized tokens verbatim', () => {
	for (const text of ['1e9999999999999999999', '1e-2049', '9'.repeat(2049), '00001', 'not-a-number']) expect(formatContractEventNumber(text)).toBe(text);
	expect(formatContractEventNumber('1e-1024').length).toBe(1026);
	expect(formatContractEventNumber('1.2300e2')).toBe('123.00');
	expect(formatContractEventNumber('-0.000')).toBe('-0.000');
});
