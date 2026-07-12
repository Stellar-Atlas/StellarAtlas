import { OrganizationScan } from '../OrganizationScan.js';

describe('OrganizationScan TOML run identity', () => {
	it('is stable for retries of the same observed scan time', () => {
		const observedAt = new Date('2026-07-10T12:00:00.000Z');

		expect(new OrganizationScan(observedAt, []).runId).toBe(
			new OrganizationScan(new Date(observedAt), []).runId
		);
		expect(new OrganizationScan(observedAt, []).runId).toBe(
			'network-scan:2026-07-10T12:00:00.000Z'
		);
	});
});
