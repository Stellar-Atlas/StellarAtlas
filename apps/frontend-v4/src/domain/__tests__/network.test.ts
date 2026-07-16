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

	it('labels missing uptime history as collecting instead of low uptime', () => {
		const tags = getOrganizationTags(
			createOrganization({
				has30DayStats: false,
				hasReliableUptime: false,
				subQuorum30DaysAvailability: 0
			})
		);

		expect(tags.some((tag) => tag.label === 'low uptime')).toBe(false);
	});

	it('does not call measured uptime low when another policy condition fails', () => {
		const tags = getOrganizationTags(
			createOrganization({
				has30DayStats: true,
				hasReliableUptime: false,
				subQuorum30DaysAvailability: 100,
				validators: ['validator-1']
			})
		);

		expect(tags.some((tag) => tag.label === 'low uptime')).toBe(false);
	});

	it('labels evaluated availability below the reliability threshold as low', () => {
		const tags = getOrganizationTags(
			createOrganization({
				has30DayStats: true,
				hasReliableUptime: false,
				subQuorum30DaysAvailability: 98
			})
		);

		expect(tags).toContainEqual({
			label: 'low uptime',
			tone: 'warning'
		});
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
