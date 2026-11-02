import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerRecordValue, recordReferenceHref } = await import('../explorer-record-value');

describe('decoded detail reference values', () => {
	it('links exact addresses and explicitly named object identifiers without truncation', () => {
		for (const [field, value, route] of [
			['source_account', 'G' + 'A'.repeat(55), 'accounts'],
			['to', 'C' + 'A'.repeat(55), 'contracts'],
			['ledger_sequence', '65213961', 'ledgers'],
			['transactionHash', 'a'.repeat(64), 'transactions'],
			['operation_id', '18446744073709551615', 'operations']
		] as const) {
			const html = renderToStaticMarkup(createElement(ExplorerRecordValue, { field, value }));
			expect(html).toContain(`href="/explorer/${route}/${value}"`);
			expect(html).toContain(`>${value}</a>`);
		}
		expect(recordReferenceHref('selling_asset', 'USD:' + 'G' + 'A'.repeat(55))).toBe('/explorer/assets/USD%3AG' + 'A'.repeat(55));
		expect(recordReferenceHref('operation_id', '429496729601', { min_ledger: '100', max_ledger: '100' })).toBe('/explorer/operations/429496729601?min_ledger=100&max_ledger=100');
	});
	it('does not invent references for memo hashes, arbitrary integers, unsafe numbers or prose', () => {
		for (const [field, value] of [['memo', 'a'.repeat(64)], ['price', '65213961'], ['ledger', '0'], ['ledger', '4294967296'], ['operation_id', Number.MAX_SAFE_INTEGER + 1], ['note', 'address ' + 'G' + 'A'.repeat(55)]])
			expect(recordReferenceHref(String(field), value)).toBeNull();
	});
	it('keeps unknown values as escaped source text', () => {
		const html = renderToStaticMarkup(createElement(ExplorerRecordValue, { field: 'memo', value: '<script>no</script>' }));
		expect(html).toContain('&lt;script&gt;no&lt;/script&gt;');
		expect(html).not.toContain('<a');
	});
});
