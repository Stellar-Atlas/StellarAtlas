import type { OrganizationV1 } from 'shared';
import { formatOrganization30DayAvailability } from '../availability';

describe('organization availability display', () => {
	it('shows collecting when the 30-day window has not been evaluated', () => {
		expect(
			formatOrganization30DayAvailability(
				createOrganization({
					has30DayStats: false,
					hasReliableUptime: false,
					subQuorum30DaysAvailability: 0
				})
			)
		).toEqual({
			detail: 'Current subquorum is available',
			tone: 'muted',
			value: 'Collecting'
		});
	});

	it('shows a measured low percentage instead of collecting', () => {
		expect(
			formatOrganization30DayAvailability(
				createOrganization({
					has30DayStats: true,
					hasReliableUptime: false,
					subQuorum30DaysAvailability: 98
				})
			)
		).toEqual({
			tone: 'warning',
			value: '98.0%'
		});
	});

	it('shows measured availability even when validator redundancy fails policy', () => {
		expect(
			formatOrganization30DayAvailability(
				createOrganization({
					has30DayStats: true,
					hasReliableUptime: false,
					subQuorum30DaysAvailability: 100,
					validators: ['validator-1']
				})
			)
		).toEqual({
			tone: 'good',
			value: '100%'
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
