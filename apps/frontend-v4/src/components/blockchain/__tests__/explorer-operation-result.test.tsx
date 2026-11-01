import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationResultFields } from '../explorer-operation-result';

describe('operation result fields', () => {
	it('shows provided codes as escaped source text, not an invented return value', () => {
		const html = renderToStaticMarkup(createElement(OperationResultFields, { row: { resultCode: 'opINNER', traceCode: '<untrusted>' } }));
		expect(html).toContain('opINNER');
		expect(html).toContain('&lt;untrusted&gt;');
		expect(html).not.toContain('Succeeded');
		expect(html).not.toContain('Return value');
	});
	it('does not turn missing, false or zero metadata into void or success', () => {
		for (const resultCode of [undefined, null, '', false, 0]) {
			const html = renderToStaticMarkup(createElement(OperationResultFields, { row: { resultCode } }));
			expect(html).toContain('Not provided');
			expect(html).not.toContain('void');
			expect(html).not.toContain('Trace code');
		}
	});
});
