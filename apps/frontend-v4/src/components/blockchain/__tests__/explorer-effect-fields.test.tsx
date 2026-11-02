import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerEffectFields } = await import('../explorer-effect-fields');
describe('typed effect references', () => {
	it('shows effect identity, full affected account and ledger-scoped operation without confusing an issuer for the account', () => {
		const account = 'G' + 'A'.repeat(55), operationId = '429496729601';
		const html = renderToStaticMarkup(createElement('dl', null, createElement(ExplorerEffectFields, {
			row: { id: operationId + '-1', account, operationId, detailsJson: '{"asset_issuer":"not-the-account"}' }, ledger: '100'
		})));
		expect(html).toContain(operationId + '-1');
		expect(html).toContain('/explorer/accounts/' + account);
		expect(html).toContain('/explorer/operations/' + operationId + '?min_ledger=100&amp;max_ledger=100');
		expect(html).not.toContain('not-the-account');
	});
	it('does not fabricate missing references or link unsafe numeric IDs', () => {
		const missing = renderToStaticMarkup(createElement(ExplorerEffectFields, { row: {}, ledger: '100' }));
		expect(missing).toContain('Not recorded'); expect(missing).not.toContain('href=');
		const unsafe = renderToStaticMarkup(createElement(ExplorerEffectFields, { row: { operationId: Number.MAX_SAFE_INTEGER + 1, accountMuxed: '<script>unknown</script>' }, ledger: '100' }));
		expect(unsafe).not.toContain('href='); expect(unsafe).toContain('&lt;script&gt;unknown&lt;/script&gt;');
	});
});
