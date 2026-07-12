import Organization from '../../domain/organization/Organization.js';
import { createDummyOrganizationId } from '../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import { OrganizationValidators } from '../../domain/organization/OrganizationValidators.js';
import { createDummyPublicKey } from '../../domain/node/__fixtures__/createDummyPublicKey.js';
import { OrganizationContactInformation } from '../../domain/organization/OrganizationContactInformation.js';
import OrganizationMeasurement from '../../domain/organization/OrganizationMeasurement.js';
import { OrganizationMeasurementAverage } from '../../domain/organization/OrganizationMeasurementAverage.js';
import { OrganizationV1DTOMapper } from '../OrganizationV1DTOMapper.js';
import { TomlState } from '../../domain/organization/scan/TomlState.js';

describe('OrganizationV1DTOMapper', () => {
	test('toOrganizationDTO', () => {
		const {
			organization,
			organizationMeasurement,
			organization24HourAverage,
			organization30DayAverage
		} = createOrganization();

		const organizationV1DTO = new OrganizationV1DTOMapper().toOrganizationV1DTO(
			organization,
			organization24HourAverage,
			organization30DayAverage
		);

		expect(organizationV1DTO.dba).toEqual(organization.contactInformation.dba);
		expect(organizationV1DTO.url).toEqual(organization.url);
		expect(organizationV1DTO.officialEmail).toEqual(
			organization.contactInformation.officialEmail
		);
		expect(organizationV1DTO.phoneNumber).toEqual(
			organization.contactInformation.phoneNumber
		);
		expect(organizationV1DTO.physicalAddress).toEqual(
			organization.contactInformation.physicalAddress
		);
		expect(organizationV1DTO.twitter).toEqual(
			organization.contactInformation.twitter
		);
		expect(organizationV1DTO.github).toEqual(
			organization.contactInformation.github
		);
		expect(organizationV1DTO.keybase).toEqual(
			organization.contactInformation.keybase
		);
		expect(organizationV1DTO.name).toEqual(organization.name);
		expect(organizationV1DTO.description).toEqual(organization.description);
		expect(organizationV1DTO.homeDomain).toEqual(organization.homeDomain);
		expect(organizationV1DTO.subQuorumAvailable).toEqual(
			organizationMeasurement.isSubQuorumAvailable
		);
		expect(organizationV1DTO.has24HourStats).toBeTruthy();
		expect(organizationV1DTO.subQuorum24HoursAvailability).toEqual(
			organization24HourAverage.isSubQuorumAvailableAvg
		);
		expect(organizationV1DTO.has30DayStats).toBeTruthy();
		expect(organizationV1DTO.subQuorum30DaysAvailability).toEqual(
			organization30DayAverage.isSubQuorumAvailableAvg
		);
		expect(organizationV1DTO.validators).toEqual(
			organization.validators.value.map((validator) => validator.value)
		);
		expect(organizationV1DTO.dateDiscovered).toEqual(
			organization.dateDiscovered.toISOString()
		);
		expect(organizationV1DTO.tomlState).toEqual(TomlState.Ok);
		expect(organizationV1DTO.tomlWarnings).toEqual([
			'TlsCertificateVerificationDisabled'
		]);
		expect(organizationV1DTO.tomlLatestAttempt).toEqual({
			authoritative: false,
			contentCaptured: true,
			observedAt: '2020-01-01T00:00:00.000Z',
			result: 'success',
			state: TomlState.Ok,
			warnings: ['TlsCertificateVerificationDisabled']
		});
		expect(organizationV1DTO.tomlLatestFailure).toBeNull();
		expect(organizationV1DTO.tomlLatestInsecureAttempt).toEqual(
			organizationV1DTO.tomlLatestAttempt
		);
		expect(organizationV1DTO.stellarToml).toEqual({
			url: 'https://domain.com/.well-known/stellar.toml',
			content: 'VERSION="2.0.0"',
			warnings: []
		});
	});

	test('maps latest failure separately from a later successful attempt', () => {
		const { organization } = createOrganization();
		const mapper = new OrganizationV1DTOMapper();
		const result = mapper.toOrganizationV1DTO(
			organization,
			undefined,
			undefined,
			{
				latestAttempt: {
					authoritative: true,
					content: 'VERSION="2.0.0"',
					observedAt: new Date('2020-01-03'),
					result: 'success',
					runId: 'success-run',
					state: TomlState.Ok,
					warnings: []
				},
				latestSuccess: {
					content: 'VERSION="2.0.0"',
					observedAt: new Date('2020-01-03'),
					warnings: []
				},
				latestFailure: {
					authoritative: false,
					content: null,
					observedAt: new Date('2020-01-02'),
					result: 'failure',
					runId: 'failure-run',
					state: TomlState.ParsingError,
					warnings: []
				},
				latestInsecureAttempt: null
			}
		);

		expect(result.tomlLatestAttempt?.result).toBe('success');
		expect(result.stellarToml?.observedAt).toBe('2020-01-03T00:00:00.000Z');
		expect(result.tomlLatestFailure).toEqual({
			authoritative: false,
			contentCaptured: false,
			observedAt: '2020-01-02T00:00:00.000Z',
			result: 'failure',
			state: TomlState.ParsingError,
			warnings: []
		});
	});

	test('fallback mapping keeps last-known-good content after failure', () => {
		const { organization } = createOrganization();
		const failedAt = new Date('2020-01-02T00:00:00.000Z');
		organization.recordTomlAttempt(
			'failure',
			TomlState.ParsingError,
			[],
			failedAt,
			'<html>',
			false,
			'failed-run'
		);

		const result = new OrganizationV1DTOMapper().toOrganizationV1DTO(
			organization
		);

		expect(result.tomlLatestAttempt).toMatchObject({
			observedAt: failedAt.toISOString(),
			result: 'failure'
		});
		expect(result.stellarToml).toMatchObject({
			content: 'VERSION="2.0.0"'
		});
	});
	test('toOrganizationSnapshotV1DTO', () => {
		const { organization } = createOrganization();

		const organizationV1DTO = new OrganizationV1DTOMapper().toOrganizationV1DTO(
			organization
		);

		const organizationSnapshotV1DTO =
			new OrganizationV1DTOMapper().toOrganizationSnapshotV1DTO(organization);

		expect(organizationSnapshotV1DTO.startDate).toEqual(
			organization.snapshotStartDate.toISOString()
		);
		expect(organizationSnapshotV1DTO.endDate).toEqual(
			organization.snapshotEndDate.toISOString()
		);
		expect(organizationSnapshotV1DTO.organization).toEqual(organizationV1DTO);
	});
	function createOrganization() {
		const time = new Date('2020-01-01');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'domain.com',
			time
		);
		organization.updateValidators(
			new OrganizationValidators([createDummyPublicKey()]),
			time
		);
		organization.updateName('name', time);
		organization.updateUrl('url', time);
		organization.updateDescription('description', time);
		organization.updateContactInformation(
			OrganizationContactInformation.create({
				dba: 'dba',
				officialEmail: 'officialEmail',
				phoneNumber: 'phoneNumber',
				physicalAddress: 'physicalAddress',
				twitter: 'twitter',
				github: 'github',
				keybase: 'keybase'
			}),
			time
		);
		organization.updateAvailability([], time);
		organization.updateStellarTomlText('VERSION="2.0.0"', time);

		const organizationMeasurement = new OrganizationMeasurement(
			time,
			organization
		);
		organizationMeasurement.isSubQuorumAvailable = true;
		organizationMeasurement.index = 1;
		organizationMeasurement.tomlState = TomlState.Ok;
		organizationMeasurement.tomlFetchResult = 'success';
		organizationMeasurement.tomlAttemptAuthoritative = false;
		organizationMeasurement.tomlAttemptContent = 'VERSION="2.0.0"';
		organizationMeasurement.tomlWarnings = [
			'TlsCertificateVerificationDisabled'
		];
		organization.addMeasurement(organizationMeasurement);

		const organization24HourAverage: OrganizationMeasurementAverage = {
			organizationId: organization.organizationId.value,
			isSubQuorumAvailableAvg: 10
		};

		const organization30DayAverage: OrganizationMeasurementAverage = {
			organizationId: organization.organizationId.value,
			isSubQuorumAvailableAvg: 10
		};
		return {
			organization,
			organizationMeasurement,
			organization24HourAverage,
			organization30DayAverage
		};
	}
});
