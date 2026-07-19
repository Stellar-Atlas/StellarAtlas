import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import Organization from '@network-scan/domain/organization/Organization.js';
import { OrganizationContactInformation } from '@network-scan/domain/organization/OrganizationContactInformation.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import { TOML_TLS_CERTIFICATE_WARNING } from '@network-scan/domain/network/scan/TomlService.js';
import {
	knownNetworkRouter,
	type KnownNetworkRouterConfig
} from '@network-scan/infrastructure/http/KnownNetworkRouter.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import type { OrganizationMeasurementDayRepository } from '@network-scan/domain/organization/OrganizationMeasurementDayRepository.js';
import type { OrganizationMeasurementRepository } from '@network-scan/domain/organization/OrganizationMeasurementRepository.js';
import { ExceptionLoggerMock } from '@core/services/__mocks__/ExceptionLoggerMock.js';
import { OrganizationV1DTOMapper } from '@network-scan/mappers/OrganizationV1DTOMapper.js';
import { OrganizationDTOService } from '@network-scan/services/OrganizationDTOService.js';
import {
	createTomlObservation,
	fetchWithTlsFallback
} from '../__fixtures__/OrganizationTomlIntegrationFixtures.js';
import { OrganizationTomlPostgresTestContext } from '../__fixtures__/OrganizationTomlPostgresTestContext.js';
import {
	ORGANIZATION_TOML_ATTEMPT_RETENTION,
	saveOrganizationMeasurement
} from '../OrganizationTomlEvidencePersistence.js';

describe('organization TOML retention and API evidence PostgreSQL', () => {
	let context: OrganizationTomlPostgresTestContext;
	jest.setTimeout(120_000);

	beforeAll(async () => {
		context = await OrganizationTomlPostgresTestContext.start();
	});
	afterEach(async () => context.reset());
	afterAll(async () => context.stop());

	test('caps attempts while retaining success and TLS provenance', async () => {
		const discoveredAt = new Date('2020-02-20T00:00:00.000Z');
		const organization = await persistEmptyOrganization(discoveredAt);
		await context.dataSource.manager.transaction(async (entityManager) => {
			const success = new OrganizationMeasurement(
				new Date(discoveredAt.getTime() + 1_000),
				organization,
				'retention-success'
			);
			success.tomlFetchResult = 'success';
			success.tomlState = TomlState.Ok;
			success.tomlAttemptAuthoritative = true;
			success.tomlAttemptContent = 'VERSION="2.0.0"';
			await saveOrganizationMeasurement(entityManager, organization, success);

			const insecure = new OrganizationMeasurement(
				new Date(discoveredAt.getTime() + 2_000),
				organization,
				'retention-insecure'
			);
			insecure.tomlFetchResult = 'success';
			insecure.tomlState = TomlState.Ok;
			insecure.tomlWarnings = [TOML_TLS_CERTIFICATE_WARNING];
			insecure.tomlAttemptAuthoritative = true;
			insecure.tomlAttemptContent = 'VERSION="2.0.0"\nORG_NAME="unsafe"';
			await saveOrganizationMeasurement(entityManager, organization, insecure);

			for (
				let index = 0;
				index < ORGANIZATION_TOML_ATTEMPT_RETENTION + 4;
				index++
			) {
				const failure = new OrganizationMeasurement(
					new Date(discoveredAt.getTime() + 3_000 + index),
					organization,
					`retention-failure-${index}`
				);
				failure.tomlFetchResult = 'failure';
				failure.tomlState = TomlState.NotFound;
				await saveOrganizationMeasurement(entityManager, organization, failure);
			}
		});

		const [counts] = (await context.dataSource.query(`
			select count(*)::integer as total,
				count(*) filter (where "scanRunId" = 'retention-success')::integer
					as successes,
				count(*) filter (where "scanRunId" = 'retention-insecure')::integer
					as insecure
			from "organization_toml_attempt"
		`)) as Array<{ insecure: number; successes: number; total: number }>;
		expect(counts).toEqual({
			insecure: 1,
			successes: 1,
			total: ORGANIZATION_TOML_ATTEMPT_RETENTION + 2
		});
	});

	test('retains facts while exposing insecure and failed API evidence', async () => {
		const discoveredAt = new Date('2020-03-01T00:00:00.000Z');
		const successAt = new Date('2020-03-02T00:00:00.000Z');
		const insecureAt = new Date('2020-03-03T00:00:00.000Z');
		const failureAt = new Date('2020-03-04T00:00:00.000Z');
		const organization = createTomlObservation(
			discoveredAt,
			successAt,
			'success',
			TomlState.Ok,
			'VERSION="2.0.0"'
		);
		organization.updateName('Trusted Organization', successAt);
		organization.updateDescription('Retained organization facts', successAt);
		organization.updateUrl('https://org.example', successAt);
		organization.updateHorizonUrl('https://horizon.org.example', successAt);
		organization.updateContactInformation(
			OrganizationContactInformation.create({
				dba: 'Trusted DBA',
				officialEmail: 'ops@org.example',
				phoneNumber: null,
				physicalAddress: null,
				twitter: null,
				github: null,
				keybase: null
			}),
			successAt
		);
		await context.organizationRepository.save([organization], discoveredAt);
		const insecureBody = 'VERSION="2.0.0"\n[DOCUMENTATION]\nORG_NAME="unsafe"';
		const insecureInfo = await fetchWithTlsFallback(insecureBody);
		expect(insecureInfo.fetchResult).toBe('success');
		if (insecureInfo.fetchResult !== 'success') return;
		organization.recordTomlAttempt(
			'success',
			insecureInfo.state,
			insecureInfo.warnings,
			insecureAt,
			insecureInfo.stellarTomlText,
			true
		);
		await context.organizationRepository.save([organization], insecureAt);
		organization.recordTomlAttempt(
			'failure',
			TomlState.ParsingError,
			[],
			failureAt,
			'<html>',
			false
		);
		await context.organizationRepository.save([organization], failureAt);

		const measurementRepository = mockDeep<OrganizationMeasurementRepository>();
		measurementRepository.findXDaysAverageAt.mockResolvedValue([]);
		measurementRepository.findTomlEvidenceAt.mockImplementation(
			(organizationIds, at) =>
				context.measurementRepository.findTomlEvidenceAt(organizationIds, at)
		);
		const dayRepository = mockDeep<OrganizationMeasurementDayRepository>();
		dayRepository.findXDaysAverageAt.mockResolvedValue([]);
		const actualUseCase = new GetKnownOrganization(
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
			actualUseCase.execute(organizationId)
		);
		const app = express();
		app.use('/known', knownNetworkRouter(config));
		const response = await request(app)
			.get(`/known/organizations/${organization.organizationId.value}`)
			.expect(200);

		expect(response.body.organization).toMatchObject({
			name: 'Trusted Organization',
			description: 'Retained organization facts',
			horizonUrl: 'https://horizon.org.example',
			officialEmail: 'ops@org.example',
			url: 'https://org.example',
			stellarToml: {
				content: 'VERSION="2.0.0"',
				observedAt: successAt.toISOString(),
				warnings: []
			},
			tomlLatestAttempt: {
				observedAt: failureAt.toISOString(),
				result: 'failure',
				state: TomlState.ParsingError
			},
			tomlLatestFailure: { observedAt: failureAt.toISOString() },
			tomlLatestInsecureAttempt: {
				authoritative: false,
				contentCaptured: true,
				observedAt: insecureAt.toISOString(),
				result: 'success',
				warnings: [TOML_TLS_CERTIFICATE_WARNING]
			}
		});
		const exactBodies = (await context.dataSource.query(
			`select content from "organization_toml_content" order by content`
		)) as Array<{ content: string }>;
		expect(exactBodies.map(({ content }) => content)).toEqual(
			['<html>', 'VERSION="2.0.0"', insecureBody].sort()
		);
	});

	async function persistEmptyOrganization(at: Date): Promise<Organization> {
		const organization = Organization.create(
			createDummyOrganizationId(),
			'org.example',
			at
		);
		await context.organizationRepository.save([organization], at);
		const persisted = (
			await context.organizationRepository.findByHomeDomains(['org.example'])
		)[0];
		if (persisted === undefined)
			throw new Error('Missing persisted organization');
		return persisted;
	}
});
