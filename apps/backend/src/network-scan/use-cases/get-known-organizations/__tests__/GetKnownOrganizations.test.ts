import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
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
		activeDto.name = 'Active organization';
		const archivedDto = createDummyOrganizationV1();
		archivedDto.id = archivedOrganization.organizationId.value;
		archivedDto.name = 'Archived organization';
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
		expect(result.value.scopeTotals).toEqual({
			'all-known': 2,
			archived: 1,
			current: 1
		});
		expect(result.value.organizations[0]).toMatchObject({
			organization: activeDto,
			current: true,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: null,
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

	it('filters archived organizations and reports page totals', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const archivedAt = new Date('2020-02-01T00:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId('archived.example'),
			'archived.example',
			start
		);
		organization.archive(archivedAt);
		const organizationDto = createDummyOrganizationV1();
		organizationDto.id = organization.organizationId.value;
		const repository = mock<OrganizationRepository>();
		const dtoService = mock<OrganizationDTOService>();
		const logger = mock<ExceptionLogger>();
		repository.findAllKnown.mockResolvedValue([organization]);
		dtoService.getOrganizationDTOs.mockResolvedValue(ok([organizationDto]));

		const result = await new GetKnownOrganizations(
			repository,
			dtoService,
			logger
		).execute({ limit: 25, offset: 0, query: '', scope: 'archived' });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			count: 1,
			page: { hasMore: false, limit: 25, offset: 0, total: 1 },
			scope: 'archived'
		});
		expect(result.value.organizations[0]?.scope).toBe('archived');
	});

	it('sorts the complete filtered inventory by name before pagination, with stable identity ties', async () => {
		const start = new Date('2026-01-01T00:00:00.000Z');
		const records = [
			{ domain: 'z.example', name: 'Zulu', dba: null },
			{ domain: 'a10.example', name: 'Alpha 10', dba: null },
			{ domain: 'a2b.example', name: 'alpha 2', dba: null },
			{ domain: 'a2a.example', name: 'Alpha 2', dba: null },
			{ domain: 'fallback.example', name: '', dba: 'Beta' },
			{ domain: 'Gamma.example', name: null, dba: null }
		];
		const organizations = records.map((record) =>
			Organization.create(
				createDummyOrganizationId(record.domain),
				record.domain,
				start
			)
		);
		organizations[4]!.archive(new Date('2026-02-01T00:00:00.000Z'));
		const dtos = records.map((record, index) => ({
			...createDummyOrganizationV1(),
			id: organizations[index]!.organizationId.value,
			name: record.name,
			dba: record.dba,
			homeDomain: record.domain
		}));
		const repository = mock<OrganizationRepository>();
		const dtoService = mock<OrganizationDTOService>();
		repository.findAllKnown.mockResolvedValue(organizations);
		dtoService.getOrganizationDTOs.mockResolvedValue(ok(dtos));
		const useCase = new GetKnownOrganizations(
			repository,
			dtoService,
			mock<ExceptionLogger>()
		);
		const first = await useCase.execute({
			limit: 2,
			offset: 0,
			query: '',
			scope: 'all-known'
		});
		const second = await useCase.execute({
			limit: 2,
			offset: 2,
			query: '',
			scope: 'all-known'
		});
		if (first.isErr() || second.isErr())
			throw new Error('Expected sorted inventory');
		expect(
			first.value.organizations.map((entry) => entry.organization.id)
		).toEqual([dtos[2]!.id, dtos[3]!.id].sort());
		expect(first.value.page).toEqual({
			limit: 2,
			offset: 0,
			total: 6,
			hasMore: true
		});
		expect(
			second.value.organizations.map((entry) => entry.organization.id)
		).toEqual([dtos[1]!.id, dtos[4]!.id]);
		const filtered = await useCase.execute({
			limit: 1,
			offset: 2,
			query: 'alpha',
			scope: 'current'
		});
		if (filtered.isErr()) throw filtered.error;
		expect(filtered.value.organizations[0]!.organization.id).toBe(dtos[1]!.id);
		expect(filtered.value.page).toEqual({
			limit: 1,
			offset: 2,
			total: 3,
			hasMore: false
		});
		expect(filtered.value.scopeTotals).toEqual({
			'all-known': 6,
			current: 5,
			archived: 1
		});
		const last = await useCase.execute({
			limit: 2,
			offset: 4,
			query: '',
			scope: 'all-known'
		});
		if (last.isErr()) throw last.error;
		expect(
			last.value.organizations.map((entry) => entry.organization.id)
		).toEqual([dtos[5]!.id, dtos[0]!.id]);
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
