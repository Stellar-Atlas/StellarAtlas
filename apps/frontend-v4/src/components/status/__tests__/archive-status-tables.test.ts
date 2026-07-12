/// <reference types="jest" />

import { formatArchiveSourceLabel } from '../archive-status-tables';

describe('archive status source labels', () => {
	it('distinguishes HTTP and HTTPS archive roots', () => {
		const httpLabel = formatArchiveSourceLabel(
			'http://history.bd-trust.org/GAYYW/'
		);
		const httpsLabel = formatArchiveSourceLabel(
			'https://history.bd-trust.org/GAYYW/'
		);

		expect(httpLabel).toBe('http://history.bd-trust.org/GAYYW');
		expect(httpsLabel).toBe('https://history.bd-trust.org/GAYYW');
		expect(httpLabel).not.toBe(httpsLabel);
	});
});
