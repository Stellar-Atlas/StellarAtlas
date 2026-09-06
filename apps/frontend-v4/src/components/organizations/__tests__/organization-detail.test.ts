/// <reference types="jest" />
import { jest } from '@jest/globals';
jest.unstable_mockModule('../organization-inventory.module.css', () => ({
	default: {}
}));
const { getOrganizationValidatorRows } = await import('../organization-detail');

describe('organization validator rows', () => {
	it('retains reported validator keys without a current node snapshot', () => {
		const publicKey =
			'GAAV2GCVFLNN522ORUYFV33E76VPC22E72S75AQ6MBR5V45Z5DWVPWEU';
		expect(getOrganizationValidatorRows([], [publicKey])).toEqual([
			{ node: null, publicKey }
		]);
	});
});
