import Organization from '../Organization.js';
import { OrganizationValidators } from '../OrganizationValidators.js';
import { ReliableUptimePolicy } from '../ReliableUptimePolicy.js';
import { createDummyOrganizationId } from '../__fixtures__/createDummyOrganizationId.js';
import { createDummyPublicKey } from '../../node/__fixtures__/createDummyPublicKey.js';

test('partial observations can have a measured rate without a full-month reliable uptime badge', () => {
	const time = new Date('2026-10-04T00:00:00Z');
	const organization = Organization.create(
		createDummyOrganizationId(),
		'example.org',
		time
	);
	organization.updateValidators(
		new OrganizationValidators(Array.from({ length: 3 }, createDummyPublicKey)),
		time
	);
	const measurement = {
		organizationId: organization.organizationId.value,
		isSubQuorumAvailableAvg: 100,
		coverage: { observedDays: 25, observedScans: 2991 }
	};
	expect(
		ReliableUptimePolicy.hasReliableUptime(organization, measurement)
	).toBe(false);
	expect(
		ReliableUptimePolicy.hasReliableUptime(organization, {
			...measurement,
			coverage: { observedDays: 30, observedScans: 4000 }
		})
	).toBe(true);
});
