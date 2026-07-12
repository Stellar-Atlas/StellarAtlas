import { formatOrganizationTomlState, getOrganizationTags } from '../network';
import type { OrganizationV1 } from 'shared';

describe('organization status labels', () => {
	it('does not expose internal TOML enum names as public badges', () => {
		const tags = getOrganizationTags(
			createOrganization({ tomlState: 'UnspecifiedError' })
		);

		expect(tags).toContainEqual({
			label: 'metadata fetch failed',
			title: 'stellar.toml state: UnspecifiedError',
			tone: 'warning'
		});
		expect(tags.some((tag) => tag.label === 'UnspecifiedError')).toBe(false);
	});

	it('uses a safe public label for future backend states', () => {
		expect(formatOrganizationTomlState('FutureState')).toBe(
			'metadata fetch issue'
		);
	});
});

function createOrganization(
	overrides: Partial<OrganizationV1>
): OrganizationV1 {
	return {
		dateDiscovered: '2026-07-12T00:00:00.000Z',
		dba: null,
		description: null,
		github: null,
		has24HourStats: true,
		has30DayStats: true,
		hasReliableUptime: true,
		homeDomain: 'example.org',
		horizonUrl: null,
		id: 'organization-id',
		keybase: null,
		logo: null,
		name: 'Example Organization',
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
		stellarToml: null,
		subQuorum24HoursAvailability: 100,
		subQuorum30DaysAvailability: 100,
		subQuorumAvailable: true,
		tomlState: 'Ok',
		tomlWarnings: [],
		twitter: null,
		url: null,
		validators: [],
		...overrides
	};
}
