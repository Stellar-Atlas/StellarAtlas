/// <reference types="jest" />

import {
	formatArchiveFailureDetail,
	formatArchiveSourceLabel
} from '../archive-status-tables';

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

	it('does not repeat an HTTP status already present in sanitized API copy', () => {
		expect(
			formatArchiveFailureDetail({
				httpStatus: 404,
				message: 'Remote archive returned HTTP 404',
				type: 'remote_missing'
			})
		).toBe('Remote archive returned HTTP 404');
	});
});
