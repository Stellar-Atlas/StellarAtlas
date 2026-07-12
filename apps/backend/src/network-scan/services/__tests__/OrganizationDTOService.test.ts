import { mock } from 'jest-mock-extended';
import type { OrganizationMeasurementRepository } from '../../domain/organization/OrganizationMeasurementRepository.js';
import type { OrganizationMeasurementDayRepository } from '../../domain/organization/OrganizationMeasurementDayRepository.js';
import { OrganizationDTOService } from '../OrganizationDTOService.js';
import Organization from '../../domain/organization/Organization.js';
import { createDummyOrganizationId } from '../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import { OrganizationMeasurementAverage } from '../../domain/organization/OrganizationMeasurementAverage.js';
import { OrganizationV1DTOMapper } from '../../mappers/OrganizationV1DTOMapper.js';
import { TomlState } from '../../domain/organization/scan/TomlState.js';

describe('OrganizationDTOService', () => {
	it('should return a list of OrganizationDTOs', async () => {
		const organizationMeasurementRepository =
			mock<OrganizationMeasurementRepository>();
		const organizationMeasurementDayRepository =
			mock<OrganizationMeasurementDayRepository>();
		const organizationMapper = mock<OrganizationV1DTOMapper>();

		const organizationDTOService = new OrganizationDTOService(
			organizationMeasurementRepository,
			organizationMeasurementDayRepository,
			organizationMapper
		);

		const time = new Date();
		const organizationA = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);
		const organizationA24HourAvg = createOrganizationMeasurementAverage(
			organizationA.organizationId.value
		);
		const organizationA30DayAvg = createOrganizationMeasurementAverage(
			organizationA.organizationId.value
		);

		const organizationB = Organization.create(
			createDummyOrganizationId(),
			'work',
			time
		);
		const organizationB24HourAvg = createOrganizationMeasurementAverage(
			organizationB.organizationId.value
		);
		const organizationB30DayAvg = createOrganizationMeasurementAverage(
			organizationB.organizationId.value
		);

		organizationMeasurementRepository.findXDaysAverageAt.mockResolvedValue([
			organizationA24HourAvg,
			organizationB24HourAvg
		]);
		organizationMeasurementRepository.findTomlEvidenceAt.mockResolvedValue([]);
		organizationMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue([
			organizationA30DayAvg,
			organizationB30DayAvg
		]);

		const result = await organizationDTOService.getOrganizationDTOs(time, [
			organizationA,
			organizationB
		]);

		expect(result.isOk()).toBe(true);
		expect(organizationMapper.toOrganizationV1DTO).toHaveBeenCalledTimes(2);
		expect(organizationMapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organizationA,
			organizationA24HourAvg,
			organizationA30DayAvg,
			{
				latestAttempt: null,
				latestFailure: null,
				latestInsecureAttempt: null,
				latestSuccess: null
			}
		);
		expect(organizationMapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organizationB,
			organizationB24HourAvg,
			organizationB30DayAvg,
			{
				latestAttempt: null,
				latestFailure: null,
				latestInsecureAttempt: null,
				latestSuccess: null
			}
		);
		expect(
			organizationMeasurementRepository.findTomlEvidenceAt
		).toHaveBeenCalledWith(
			[organizationA.organizationId.value, organizationB.organizationId.value],
			time
		);
		expect(
			organizationMeasurementDayRepository.findXDaysAverageAt
		).toHaveBeenCalledWith(time, 30);
	});

	it('should return an error if the 24 hour average fails', async () => {
		const organizationMeasurementRepository =
			mock<OrganizationMeasurementRepository>();
		const organizationMeasurementDayRepository =
			mock<OrganizationMeasurementDayRepository>();
		const organizationMapper = mock<OrganizationV1DTOMapper>();

		const organizationDTOService = new OrganizationDTOService(
			organizationMeasurementRepository,
			organizationMeasurementDayRepository,
			organizationMapper
		);

		const time = new Date();
		const organizationA = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);

		organizationMeasurementRepository.findXDaysAverageAt.mockRejectedValue(
			new Error('test error')
		);
		organizationMeasurementRepository.findTomlEvidenceAt.mockResolvedValue([]);
		organizationMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue(
			[]
		);

		const result = await organizationDTOService.getOrganizationDTOs(time, [
			organizationA
		]);

		expect(result.isErr()).toBe(true);
		expect(organizationMapper.toOrganizationV1DTO).not.toHaveBeenCalled();
	});

	it('retains persisted failure evidence after a newer in-memory success', async () => {
		const organizationMeasurementRepository =
			mock<OrganizationMeasurementRepository>();
		const organizationMeasurementDayRepository =
			mock<OrganizationMeasurementDayRepository>();
		const organizationMapper = mock<OrganizationV1DTOMapper>();
		const service = new OrganizationDTOService(
			organizationMeasurementRepository,
			organizationMeasurementDayRepository,
			organizationMapper
		);
		const successAt = new Date('2026-07-10T12:00:00.000Z');
		const failureAt = new Date('2026-07-10T11:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			successAt
		);
		organization.updateStellarTomlText('VERSION="2.0.0"', successAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[],
			successAt,
			'VERSION="2.0.0"',
			true,
			'in-memory-success'
		);
		organizationMeasurementRepository.findXDaysAverageAt.mockResolvedValue([]);
		organizationMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue(
			[]
		);
		organizationMeasurementRepository.findTomlEvidenceAt.mockResolvedValue([
			{
				organizationId: organization.organizationId.value,
				latestAttempt: {
					authoritative: false,
					content: null,
					observedAt: failureAt,
					result: 'failure',
					runId: 'persisted-failure',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestSuccess: null,
				latestFailure: {
					authoritative: false,
					content: null,
					observedAt: failureAt,
					result: 'failure',
					runId: 'persisted-failure',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestInsecureAttempt: null
			}
		]);

		const result = await service.getOrganizationDTOs(successAt, [organization]);

		expect(result.isOk()).toBe(true);
		expect(organizationMapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organization,
			undefined,
			undefined,
			{
				latestAttempt: {
					authoritative: true,
					content: 'VERSION="2.0.0"',
					observedAt: successAt,
					result: 'success',
					runId: 'in-memory-success',
					state: TomlState.Ok,
					warnings: []
				},
				latestSuccess: {
					content: 'VERSION="2.0.0"',
					observedAt: successAt,
					warnings: []
				},
				latestFailure: {
					authoritative: false,
					content: null,
					observedAt: failureAt,
					result: 'failure',
					runId: 'persisted-failure',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestInsecureAttempt: null
			}
		);
	});

	it('keeps sequence-backed persistence authoritative on equal timestamps', async () => {
		const organizationMeasurementRepository =
			mock<OrganizationMeasurementRepository>();
		const organizationMeasurementDayRepository =
			mock<OrganizationMeasurementDayRepository>();
		const organizationMapper = mock<OrganizationV1DTOMapper>();
		const service = new OrganizationDTOService(
			organizationMeasurementRepository,
			organizationMeasurementDayRepository,
			organizationMapper
		);
		const observedAt = new Date('2026-07-10T12:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			observedAt
		);
		organization.recordTomlAttempt(
			'failure',
			TomlState.ParsingError,
			[],
			observedAt
		);
		const persistedEvidence = {
			organizationId: organization.organizationId.value,
			latestAttempt: {
				authoritative: true,
				content: 'VERSION="2.0.0"',
				observedAt,
				result: 'success' as const,
				runId: 'persisted-success',
				sequence: '17',
				state: TomlState.Ok,
				warnings: []
			},
			latestFailure: null,
			latestInsecureAttempt: null,
			latestSuccess: {
				content: 'VERSION="2.0.0"',
				observedAt,
				sequence: '17',
				warnings: []
			}
		};
		organizationMeasurementRepository.findXDaysAverageAt.mockResolvedValue([]);
		organizationMeasurementRepository.findTomlEvidenceAt.mockResolvedValue([
			persistedEvidence
		]);
		organizationMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue(
			[]
		);

		const result = await service.getOrganizationDTOs(observedAt, [
			organization
		]);

		expect(result.isOk()).toBe(true);
		expect(organizationMapper.toOrganizationV1DTO).toHaveBeenCalledWith(
			organization,
			undefined,
			undefined,
			{
				latestAttempt: persistedEvidence.latestAttempt,
				latestFailure: persistedEvidence.latestFailure,
				latestInsecureAttempt: persistedEvidence.latestInsecureAttempt,
				latestSuccess: persistedEvidence.latestSuccess
			}
		);
	});

	it('should return an error if the 30 day average fails', async () => {
		const organizationMeasurementRepository =
			mock<OrganizationMeasurementRepository>();
		const organizationMeasurementDayRepository =
			mock<OrganizationMeasurementDayRepository>();
		const organizationMapper = mock<OrganizationV1DTOMapper>();

		const organizationDTOService = new OrganizationDTOService(
			organizationMeasurementRepository,
			organizationMeasurementDayRepository,
			organizationMapper
		);

		const time = new Date();
		const organizationA = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);

		organizationMeasurementRepository.findXDaysAverageAt.mockResolvedValue([]);
		organizationMeasurementRepository.findTomlEvidenceAt.mockResolvedValue([]);
		organizationMeasurementDayRepository.findXDaysAverageAt.mockRejectedValue(
			new Error('test error')
		);

		const result = await organizationDTOService.getOrganizationDTOs(time, [
			organizationA
		]);

		expect(result.isErr()).toBe(true);
		expect(organizationMapper.toOrganizationV1DTO).not.toHaveBeenCalled();
	});

	function createOrganizationMeasurementAverage(
		organizationId: string
	): OrganizationMeasurementAverage {
		return {
			organizationId: organizationId,
			isSubQuorumAvailableAvg: 1
		};
	}
});
