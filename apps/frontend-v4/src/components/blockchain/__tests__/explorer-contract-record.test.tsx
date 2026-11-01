import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerContractRecord } = await import('../explorer-contract-record');

describe('ExplorerContractRecord outcomes', () => {
	it.each([undefined, null, 'false', 0])('does not infer failure from %s', (value) => {
		const html = renderToStaticMarkup(createElement(ExplorerContractRecord, {
			tab: 'events', row: { successful: value, inSuccessfulContractCall: value }
		}));
		expect(html).toContain('Transaction outcome unknown');
		expect(html).toContain('Contract-call outcome unknown');
		expect(html).not.toContain('Transaction failed');
		expect(html).not.toContain('Not in a successful contract call');
	});

	it.each([true, false])('retains the explicit boolean outcome %s', (value) => {
		const html = renderToStaticMarkup(createElement(ExplorerContractRecord, {
			tab: 'events', row: { successful: value, inSuccessfulContractCall: value }
		}));
		expect(html).toContain(value ? 'Transaction successful' : 'Transaction failed');
		expect(html).toContain(value ? 'In successful contract call' : 'Not in a successful contract call');
	});
});
