import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { OrganizationV1 } from 'shared';
import { GetOrganizations } from '@network-scan/use-cases/get-organizations/GetOrganizations.js';
import { GetCrossCheckOrganizations } from '../GetCrossCheckOrganizations.js';

describe('GetCrossCheckOrganizations', () => {
	let getOrganizations: MockProxy<GetOrganizations>;
	let getCrossCheckOrganizations: GetCrossCheckOrganizations;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getOrganizations = mock<GetOrganizations>();
		getCrossCheckOrganizations = new GetCrossCheckOrganizations(
			getOrganizations
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should map persisted organizations without external comparison', async () => {
		getOrganizations.execute.mockResolvedValue(
			ok([
				createOrganization({
					id: 'org-a',
					name: 'Org A',
					validators: ['GA', 'GB']
				}),
				createOrganization({ id: 'org-c', name: 'Org C' }),
				createOrganization({
					id: 'org-b',
					name: 'Org B',
					tomlState: 'ParsingError'
				})
			])
		);

		const result = await getCrossCheckOrganizations.execute({ limit: 2 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			limit: 2,
			count: 2,
			totalEligibleCount: 3,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection: 'latest_network_snapshot_active_organizations'
		});
		expect(result.value.organizations).toHaveLength(2);
		expect(result.value.organizations[0]).toMatchObject({
			organizationId: 'org-a',
			comparisonStatus: 'not_compared',
			radarComparison: {
				sourceId: 'withobsrvr-radar',
				probe: 'not_run',
				comparisonStatus: 'not_compared'
			},
			stellarAtlas: {
				id: 'org-a',
				organizationId: 'org-a',
				name: 'Org A',
				validatorPublicKeys: ['GA', 'GB'],
				validatorPublicKeyCount: 2,
				organizationEvidenceStatus: 'organization_snapshot_observed',
				tomlEvidenceStatus: 'toml_unknown'
			}
		});
		expect(result.value.organizations[1]).toMatchObject({
			organizationId: 'org-b',
			stellarAtlas: {
				tomlState: 'ParsingError',
				tomlEvidenceStatus: 'toml_issue_observed'
			}
		});
		expect(getOrganizations.execute).toHaveBeenCalledWith({});
	});

	it('should map successful TOML evidence explicitly', async () => {
		getOrganizations.execute.mockResolvedValue(
			ok([createOrganization({ id: 'org-a', tomlState: 'Ok' })])
		);

		const result = await getCrossCheckOrganizations.execute();

		expect(
			result._unsafeUnwrap().organizations[0].stellarAtlas.tomlEvidenceStatus
		).toBe('toml_ok');
	});

	it('should default and cap limits', async () => {
		getOrganizations.execute.mockResolvedValue(ok([]));

		const defaulted = await getCrossCheckOrganizations.execute();
		const capped = await getCrossCheckOrganizations.execute({ limit: 200 });

		expect(defaulted._unsafeUnwrap().limit).toBe(50);
		expect(capped._unsafeUnwrap().limit).toBe(100);
	});

	it('should propagate organization read errors', async () => {
		const error = new Error('database unavailable');
		getOrganizations.execute.mockResolvedValue(err(error));

		const result = await getCrossCheckOrganizations.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});

function createOrganization(
	overrides: Partial<OrganizationV1> = {}
): OrganizationV1 {
	return {
		dateDiscovered: '2026-07-03T00:00:00.000Z',
		dba: null,
		description: null,
		github: null,
		has24HourStats: false,
		has30DayStats: false,
		hasReliableUptime: false,
		homeDomain: 'example.com',
		horizonUrl: null,
		id: 'org-id',
		keybase: null,
		logo: null,
		name: null,
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
		subQuorum24HoursAvailability: 0,
		subQuorum30DaysAvailability: 0,
		subQuorumAvailable: false,
		tomlState: 'Unknown',
		tomlWarnings: [],
		twitter: null,
		url: null,
		validators: [],
		...overrides
	};
}
