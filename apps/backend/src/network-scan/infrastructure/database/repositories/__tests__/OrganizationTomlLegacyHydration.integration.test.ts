import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationMeasurementDayRepository } from '@network-scan/domain/organization/OrganizationMeasurementDayRepository.js';
import type { OrganizationMeasurementRepository } from '@network-scan/domain/organization/OrganizationMeasurementRepository.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import {
	knownNetworkRouter,
	type KnownNetworkRouterConfig
} from '@network-scan/infrastructure/http/KnownNetworkRouter.js';
import { OrganizationV1DTOMapper } from '@network-scan/mappers/OrganizationV1DTOMapper.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import { ExceptionLoggerMock } from '@core/services/__mocks__/ExceptionLoggerMock.js';
import { OrganizationTomlPostgresTestContext } from '../__fixtures__/OrganizationTomlPostgresTestContext.js';

describe('legacy organization TOML hydration PostgreSQL', () => {
	let context: OrganizationTomlPostgresTestContext;
	jest.setTimeout(120_000);

	beforeAll(async () => {
		context = await OrganizationTomlPostgresTestContext.start();
		await context.dataSource.query(`
			alter table "organization_measurement"
				alter column "tomlFetchResult" drop not null,
				alter column "tomlFetchResult" drop default,
				alter column "tomlEvidenceSequence" drop not null,
				alter column "tomlEvidenceSequence" drop default
		`);
	});
	afterEach(async () => context.reset());
	afterAll(async () => context.stop());

	it('returns explicit unknown evidence without rewriting nullable legacy columns', async () => {
		const observedAt = new Date('2020-01-02T00:00:00.000Z');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			new Date('2020-01-01T00:00:00.000Z')
		);
		await context.organizationRepository.save(
			[organization],
			organization.dateDiscovered
		);
		const [storedOrganization] = (await context.dataSource.query(
			`select id from "organization" where "organizationIdValue" = $1`,
			[organization.organizationId.value]
		)) as Array<{ id: number }>;
		if (storedOrganization === undefined)
			throw new Error('Missing organization');
		await context.dataSource.query(
			`insert into "organization_measurement" (
				"time", "organizationId", "isSubQuorumAvailable", "index",
				"tomlState", "tomlWarnings", "tomlFetchResult",
				"tomlEvidenceSequence", "scanRunId"
			 ) values ($1, $2, false, 0, $3, '[]'::jsonb, null, null, null)`,
			[observedAt, storedOrganization.id, TomlState.Ok]
		);

		const measurementRepository = mockDeep<OrganizationMeasurementRepository>();
		measurementRepository.findXDaysAverageAt.mockResolvedValue([]);
		measurementRepository.findTomlEvidenceAt.mockImplementation(
			(organizationIds, at) =>
				context.measurementRepository.findTomlEvidenceAt(organizationIds, at)
		);
		const dayRepository = mockDeep<OrganizationMeasurementDayRepository>();
		dayRepository.findXDaysAverageAt.mockResolvedValue([]);
		const useCase = new GetKnownOrganization(
			context.organizationRepository,
			new OrganizationDTOService(
				measurementRepository,
				dayRepository,
				new OrganizationV1DTOMapper()
			),
			new ExceptionLoggerMock()
		);
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganization.execute.mockImplementation((organizationId) =>
			useCase.execute(organizationId)
		);
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		const response = await request(app)
			.get(`/known/organizations/${organization.organizationId.value}`)
			.expect(200);

		expect(response.body.organization).toMatchObject({
			stellarToml: null,
			tomlLatestAttempt: null,
			tomlLatestFailure: null,
			tomlLatestInsecureAttempt: null,
			tomlState: TomlState.Unknown,
			tomlWarnings: []
		});
		const [storedMeasurement] = (await context.dataSource.query(
			`select "tomlFetchResult", "tomlEvidenceSequence", "scanRunId"
			 from "organization_measurement" where "organizationId" = $1`,
			[storedOrganization.id]
		)) as Array<Record<string, unknown>>;
		expect(storedMeasurement).toEqual({
			scanRunId: null,
			tomlEvidenceSequence: null,
			tomlFetchResult: null
		});
	});
});
