import type { OrganizationV1 } from 'shared';
import {
	formatOrganization24HourAvailability,
	formatOrganization30DayAvailability,
	hasEvaluatedOrganization30DayAvailability
} from '../availability';

describe('organization availability display', () => {
	it('never rounds a currently healthy organization history up to perfect uptime', () => {
		expect(
			formatOrganization24HourAvailability(
				createOrganization({ subQuorum24HoursAvailability: 94.65 })
			)
		).toEqual({ tone: 'warning', value: '94.7%' });
	});
	it('keeps a measured low rate visible after current recovery and labels coverage', () => {
		const organization = createOrganization({
			subQuorum30DaysAvailability: 42.39,
			availability30DaysCoverage: { observedDays: 25, observedScans: 2991 }
		});
		expect(hasEvaluatedOrganization30DayAvailability(organization)).toBe(true);
		expect(formatOrganization30DayAvailability(organization)).toEqual({
			tone: 'warning',
			value: '42.4%',
			detail: '25 observed days · monitoring gaps excluded'
		});
	});
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
