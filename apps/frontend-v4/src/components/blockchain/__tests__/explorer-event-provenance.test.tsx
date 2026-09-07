import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
const { ExplorerEventProvenance } =
	await import('../explorer-event-provenance');
describe('contract event provenance', () => {
	it('labels genuine modern diagnostic events using recorded classification', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEventProvenance, {
				row: {
					classification: {
						transactionKind: 'soroban',
						eventKind: 'diagnostic',
						provenance: 'complete',
						sorobanExecutionEvidence: true
					}
				}
			})
		);
		expect(html).toContain('Diagnostic event');
		expect(html).toContain('Soroban transaction');
		expect(html).toContain('Soroban execution evidence present');
		expect(html).not.toContain('Incomplete event provenance');
	});
	it('does not infer Soroban from contract address, date, or a successful call flag', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEventProvenance, {
				row: {
					contract_id: 'C123',
					successful: true,
					in_successful_contract_call: true,
					closed_at: '2019-01-01'
				}
			})
		);
		expect(html).toContain('Unclassified event');
		expect(html).toContain('No confirmed Soroban execution evidence');
		expect(html).toContain('Incomplete event provenance');
	});
	it('keeps classic fee evidence separate', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEventProvenance, {
				row: {
					classification: {
						transactionKind: 'classic',
						eventKind: 'fee',
						provenance: 'complete',
						sorobanExecutionEvidence: false
					}
				}
			})
		);
		expect(html).toContain('Classic transaction');
		expect(html).toContain('Fee event');
		expect(html).not.toContain('Soroban transaction');
	});
});
