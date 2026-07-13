/// <reference types="jest" />

import { getOrganizationValidatorRows } from '../organization-detail';

describe('organization validator rows', () => {
	it('retains reported validator keys without a current node snapshot', () => {
		const publicKey =
			'GAAV2GCVFLNN522ORUYFV33E76VPC22E72S75AQ6MBR5V45Z5DWVPWEU';
		const rows = getOrganizationValidatorRows([], [publicKey]);

		expect(rows).toEqual([{ node: null, publicKey }]);
	});
});
