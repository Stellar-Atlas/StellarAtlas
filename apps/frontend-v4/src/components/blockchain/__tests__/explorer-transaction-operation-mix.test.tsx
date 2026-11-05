import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule('../explorer-transaction-operation-mix.module.css', () => ({ default: {} }));
const { ExplorerTransactionOperationMix } = await import('../explorer-transaction-operation-mix');

it('counts only the supplied page, preserving future types and labeling unreported types', () => {
	const first = renderToStaticMarkup(<ExplorerTransactionOperationMix rows={[
		{ type: 'future_op' }, { type: 'payment' }, { type: 'payment' },
		{ type: ' ' }, { classification: 'soroban' }, { type: 99 }
	]} />);
	expect(first).toContain('aria-label="Operation types on this page"');
	expect(first).toContain('<dt>payment</dt><dd>2</dd>');
	expect(first).toContain('<dt>future_op</dt><dd>1</dd>');
	expect(first).toContain('<dt>Type not reported</dt><dd>3</dd>');
	expect(first).not.toContain('soroban');

	const next = renderToStaticMarkup(<ExplorerTransactionOperationMix rows={[{ type: 'set_options' }]} />);
	expect(next).toContain('<dt>set_options</dt><dd>1</dd>');
	expect(next).not.toContain('payment');
	expect(renderToStaticMarkup(<ExplorerTransactionOperationMix rows={[]} />)).toBe('');
});

it('renders the counted names without merging their labels or hiding underscore-only names', () => {
	const html = renderToStaticMarkup(<ExplorerTransactionOperationMix rows={[
		{ type: 'future_operation' }, { type: 'future_operation' },
		{ type: 'future operation' }, { type: '_' }, { type: '__' }
	]} />);
	expect(html).toContain('<dt>future_operation</dt><dd>2</dd>');
	expect(html).toContain('<dt>future operation</dt><dd>1</dd>');
	expect(html).toContain('<dt>_</dt><dd>1</dd>');
	expect(html).toContain('<dt>__</dt><dd>1</dd>');
});
