import { mock } from 'jest-mock-extended';
import Organization from '../../domain/organization/Organization.js';
import { createDummyOrganizationId } from '../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationMeasurementDayRepository } from '../../domain/organization/OrganizationMeasurementDayRepository.js';
import type { OrganizationMeasurementRepository } from '../../domain/organization/OrganizationMeasurementRepository.js';
import { TomlState } from '../../domain/organization/scan/TomlState.js';
import { TOML_TLS_CERTIFICATE_WARNING } from '../../domain/network/scan/TomlService.js';
import { OrganizationV1DTOMapper } from '../../mappers/OrganizationV1DTOMapper.js';
import { OrganizationDTOService } from '../OrganizationDTOService.js';

describe('OrganizationDTOService TOML fallback evidence', () => {
	it('keeps aggregate last-good content when migrated evidence has no success body', async () => {
		const observedAt = new Date('2026-07-10T12:00:00.000Z');
		const organization = createOrganizationWithLastGood(observedAt);
		const repositories = createRepositories();
		const mapper = mock<OrganizationV1DTOMapper>();
		repositories.measurements.findTomlEvidenceAt.mockResolvedValue([
			{
				organizationId: organization.organizationId.value,
				latestAttempt: {
					authoritative: false,
					content: null,
					observedAt,
					result: 'failure',
					runId: 'legacy-failure',
					sequence: '5',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestFailure: {
					authoritative: false,
					content: null,
					observedAt,
					result: 'failure',
					runId: 'legacy-failure',
					sequence: '5',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestInsecureAttempt: null,
				latestSuccess: null
			}
		]);

		await new OrganizationDTOService(
			repositories.measurements,
			repositories.days,
			mapper
		).getOrganizationDTOs(observedAt, [organization]);

		expect(mapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organization,
			undefined,
			undefined,
			expect.objectContaining({
				latestSuccess: {
					content: 'VERSION="2.0.0"',
					observedAt: null,
					warnings: []
				}
			})
		);
	});

	it('does not relabel a quarantined TLS success as a failure', async () => {
		const goodAt = new Date('2026-07-10T10:00:00.000Z');
		const insecureAt = new Date('2026-07-10T11:00:00.000Z');
		const organization = createOrganizationWithLastGood(goodAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[TOML_TLS_CERTIFICATE_WARNING],
			insecureAt,
			'VERSION="2.0.0"\nORG_NAME="unsafe"',
			false,
			'insecure-retry'
		);
		const repositories = createRepositories();
		const mapper = mock<OrganizationV1DTOMapper>();

		await new OrganizationDTOService(
			repositories.measurements,
			repositories.days,
			mapper
		).getOrganizationDTOs(insecureAt, [organization]);

		expect(mapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organization,
			undefined,
			undefined,
			expect.objectContaining({
				latestFailure: null,
				latestInsecureAttempt: expect.objectContaining({
					authoritative: false,
					result: 'success',
					warnings: [TOML_TLS_CERTIFICATE_WARNING]
				}),
				latestSuccess: expect.objectContaining({
					content: 'VERSION="2.0.0"'
				})
			})
		);
	});

	it('uses provenance sequence to resolve equal observed times', async () => {
		const observedAt = new Date('2026-07-10T11:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			observedAt
		);
		organization.recordTomlAttempt(
			'failure',
			TomlState.NotFound,
			[],
			observedAt,
			null,
			false,
			'newer-run'
		);
		const measurement = organization.latestMeasurement();
		if (measurement === null) throw new Error('Missing measurement');
		measurement.tomlEvidenceSequence = '18';
		const repositories = createRepositories();
		const mapper = mock<OrganizationV1DTOMapper>();
		repositories.measurements.findTomlEvidenceAt.mockResolvedValue([
			{
				organizationId: organization.organizationId.value,
				latestAttempt: {
					authoritative: false,
					content: null,
					observedAt,
					result: 'failure',
					runId: 'older-run',
					sequence: '17',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestFailure: null,
				latestInsecureAttempt: null,
				latestSuccess: null
			}
		]);

		await new OrganizationDTOService(
			repositories.measurements,
			repositories.days,
			mapper
		).getOrganizationDTOs(observedAt, [organization]);

		expect(mapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organization,
			undefined,
			undefined,
			expect.objectContaining({
				latestAttempt: expect.objectContaining({
					runId: 'newer-run',
					sequence: '18'
				}),
				latestFailure: expect.objectContaining({
					runId: 'newer-run',
					sequence: '18'
				})
			})
		);
	});
});

function createOrganizationWithLastGood(at: Date): Organization {
	const organization = Organization.create(
		createDummyOrganizationId(),
		'org.example',
		at
	);
	organization.updateStellarTomlText('VERSION="2.0.0"', at);
	return organization;
}

function createRepositories() {
	const measurements = mock<OrganizationMeasurementRepository>();
	const days = mock<OrganizationMeasurementDayRepository>();
	measurements.findXDaysAverageAt.mockResolvedValue([]);
	measurements.findTomlEvidenceAt.mockResolvedValue([]);
	days.findXDaysAverageAt.mockResolvedValue([]);
	return { days, measurements };
}
