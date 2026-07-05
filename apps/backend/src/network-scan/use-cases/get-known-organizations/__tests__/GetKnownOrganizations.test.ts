import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Snapshot } from '@core/domain/Snapshot.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import { GetKnownOrganizations } from '../GetKnownOrganizations.js';

describe('GetKnownOrganizations', () => {
	it('returns current and archived organizations with snapshot and measurement evidence', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const archivedAt = new Date('2020-02-01T00:00:00.000Z');
		const activeOrganization = Organization.create(
			createDummyOrganizationId('active.example'),
			'active.example',
			start
		);
		activeOrganization.addMeasurement(
			new OrganizationMeasurement(start, activeOrganization)
		);
		const archivedOrganization = Organization.create(
			createDummyOrganizationId('archived.example'),
			'archived.example',
			start
		);
		archivedOrganization.archive(archivedAt);

		const activeDto = createDummyOrganizationV1();
		activeDto.id = activeOrganization.organizationId.value;
		const archivedDto = createDummyOrganizationV1();
		archivedDto.id = archivedOrganization.organizationId.value;
		const organizationRepository = mock<OrganizationRepository>();
		const organizationDTOService = mock<OrganizationDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		organizationRepository.findAllKnown.mockResolvedValue([
			activeOrganization,
			archivedOrganization
		]);
		organizationDTOService.getOrganizationDTOs.mockResolvedValue(
			ok([activeDto, archivedDto])
		);

		const result = await new GetKnownOrganizations(
			organizationRepository,
			organizationDTOService,
			exceptionLogger
		).execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.count).toBe(2);
		expect(result.value.organizations[0]).toMatchObject({
			organization: activeDto,
			current: true,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: Snapshot.MAX_DATE.toISOString(),
			lastSeen: start.toISOString(),
			lastMeasurementAt: start.toISOString()
		});
		expect(result.value.organizations[1]).toMatchObject({
			organization: archivedDto,
			current: false,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: archivedAt.toISOString(),
			lastSeen: archivedAt.toISOString(),
			lastMeasurementAt: null
		});
	});

	it('returns errors from the DTO service', async () => {
		const organizationRepository = mock<OrganizationRepository>();
		const organizationDTOService = mock<OrganizationDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const error = new Error('mapping failed');
		organizationRepository.findAllKnown.mockResolvedValue([]);
		organizationDTOService.getOrganizationDTOs.mockResolvedValue(err(error));

		const result = await new GetKnownOrganizations(
			organizationRepository,
			organizationDTOService,
			exceptionLogger
		).execute();

		expect(result.isErr()).toBe(true);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});
