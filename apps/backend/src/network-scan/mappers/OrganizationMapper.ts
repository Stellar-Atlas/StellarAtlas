import { Organization as OrganizationDTO } from 'shared';
import { OrganizationMeasurementAverage } from '../domain/organization/OrganizationMeasurementAverage.js';
import { OrganizationSnapShot as DomainOrganizationSnapShot } from 'shared';
import Organization from '../domain/organization/Organization.js';
import { injectable } from 'inversify';
import 'reflect-metadata';

//@deprecated
@injectable()
export class OrganizationMapper {
	toOrganizationDTO(
		organization: Organization,
		measurement24HourAverage?: OrganizationMeasurementAverage,
		measurement30DayAverage?: OrganizationMeasurementAverage
	): OrganizationDTO {
		const organizationDTO = new OrganizationDTO(
			organization.organizationId.value,
			organization.name || ''
		);

		organizationDTO.dateDiscovered = organization.dateDiscovered;
		organizationDTO.dba = organization.contactInformation.dba;
		organizationDTO.url = organization.url;
		organizationDTO.officialEmail =
			organization.contactInformation.officialEmail;
		organizationDTO.phoneNumber = organization.contactInformation.phoneNumber;
		organizationDTO.physicalAddress =
			organization.contactInformation.physicalAddress;
		organizationDTO.twitter = organization.contactInformation.twitter;
		organizationDTO.github = organization.contactInformation.github;
		organizationDTO.description = organization.description;
		organizationDTO.keybase = organization.contactInformation.keybase;
		organizationDTO.horizonUrl = organization.horizonUrl;
		organizationDTO.homeDomain = organization.homeDomain;
		const latestTomlAttempt =
			organization.latestMeasurement()?.toTomlAttempt() ?? null;
		organizationDTO.stellarToml =
			organization.stellarTomlText === null
				? null
				: {
						url: `https://${organization.homeDomain}/.well-known/stellar.toml`,
						content: organization.stellarTomlText,
						...(latestTomlAttempt?.authoritative === true &&
						latestTomlAttempt.result === 'success' &&
						latestTomlAttempt.content === organization.stellarTomlText
							? { observedAt: latestTomlAttempt.observedAt.toISOString() }
							: {})
					};

		organization.validators.value.forEach((validator) => {
			organizationDTO.validators.push(validator.value);
		});

		organizationDTO.subQuorumAvailable = organization.isAvailable();

		if (measurement24HourAverage) {
			organizationDTO.has24HourStats = true;
			organizationDTO.subQuorum24HoursAvailability =
				measurement24HourAverage.isSubQuorumAvailableAvg;
		}

		if (measurement30DayAverage) {
			organizationDTO.has30DayStats = true;
			organizationDTO.subQuorum30DaysAvailability =
				measurement30DayAverage.isSubQuorumAvailableAvg;
		}

		return organizationDTO;
	}

	toOrganizationSnapshotDTO(
		organization: Organization
	): DomainOrganizationSnapShot {
		return new DomainOrganizationSnapShot(
			organization.snapshotStartDate,
			organization.snapshotEndDate,
			this.toOrganizationDTO(organization)
		);
	}
}
