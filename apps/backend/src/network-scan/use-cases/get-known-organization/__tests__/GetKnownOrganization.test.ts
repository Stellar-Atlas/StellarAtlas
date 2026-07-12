import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import { GetKnownOrganization } from '../GetKnownOrganization.js';

describe('GetKnownOrganization', () => {
	it('returns a known organization by id', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId('known.example'),
			'known.example',
			start
		);
		organization.addMeasurement(
			new OrganizationMeasurement(start, organization)
		);
		const organizationDto = createDummyOrganizationV1();
		organizationDto.id = organization.organizationId.value;
		const organizationRepository = mock<OrganizationRepository>();
		const organizationDTOService = mock<OrganizationDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		organizationRepository.findByOrganizationId.mockResolvedValue(organization);
		organizationDTOService.getOrganizationDTOs.mockResolvedValue(
			ok([organizationDto])
		);

		const result = await new GetKnownOrganization(
			organizationRepository,
			organizationDTOService,
			exceptionLogger
		).execute(organization.organizationId.value);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			organization: organizationDto,
			current: true,
			scope: 'current',
			lastSeen: start.toISOString()
		});
	});

	it('returns null when the organization is unknown', async () => {
		const organizationRepository = mock<OrganizationRepository>();
		const organizationDTOService = mock<OrganizationDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		organizationRepository.findByOrganizationId.mockResolvedValue(null);

		const result = await new GetKnownOrganization(
			organizationRepository,
			organizationDTOService,
			exceptionLogger
		).execute('missing-id');

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toBeNull();
		expect(organizationDTOService.getOrganizationDTOs).not.toHaveBeenCalled();
	});

	it('returns errors from the DTO service', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId('known.example'),
			'known.example',
			start
		);
		const organizationRepository = mock<OrganizationRepository>();
		const organizationDTOService = mock<OrganizationDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const error = new Error('mapping failed');
		organizationRepository.findByOrganizationId.mockResolvedValue(organization);
		organizationDTOService.getOrganizationDTOs.mockResolvedValue(err(error));

		const result = await new GetKnownOrganization(
			organizationRepository,
			organizationDTOService,
			exceptionLogger
		).execute(organization.organizationId.value);

		expect(result.isErr()).toBe(true);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});
