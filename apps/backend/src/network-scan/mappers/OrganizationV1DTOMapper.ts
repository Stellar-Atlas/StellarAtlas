import {
	type OrganizationSnapshotV1,
	type OrganizationTomlAttemptV1,
	type OrganizationTomlFailureV1,
	type OrganizationV1
} from 'shared';
import { OrganizationMeasurementAverage } from '../domain/organization/OrganizationMeasurementAverage.js';
import Organization from '../domain/organization/Organization.js';
import { injectable } from 'inversify';
import 'reflect-metadata';
import { ReliableUptimePolicy } from '../domain/organization/ReliableUptimePolicy.js';
import type {
	OrganizationTomlAttempt,
	OrganizationTomlEvidence,
	OrganizationTomlFailure
} from '../domain/organization/scan/OrganizationTomlAttempt.js';

@injectable()
export class OrganizationV1DTOMapper {
	toOrganizationV1DTO(
		organization: Organization,
		measurement24HourAverage?: OrganizationMeasurementAverage,
		measurement30DayAverage?: OrganizationMeasurementAverage,
		tomlEvidence?: OrganizationTomlEvidence
	): OrganizationV1 {
		const evidence = tomlEvidence ?? this.getInMemoryTomlEvidence(organization);
		const latestAttempt = evidence.latestAttempt;
		return {
			id: organization.organizationId.value,
			name: organization.name,
			dateDiscovered: organization.dateDiscovered.toISOString(),
			dba: organization.contactInformation.dba,
			url: organization.url,
			officialEmail: organization.contactInformation.officialEmail,
			phoneNumber: organization.contactInformation.phoneNumber,
			physicalAddress: organization.contactInformation.physicalAddress,
			twitter: organization.contactInformation.twitter,
			github: organization.contactInformation.github,
			description: organization.description,
			keybase: organization.contactInformation.keybase,
			horizonUrl: organization.horizonUrl,
			homeDomain: organization.homeDomain,
			validators: organization.validators.value.map(
				(validator) => validator.value
			),
			subQuorumAvailable: organization.isAvailable(),
			has24HourStats: measurement24HourAverage !== undefined,
			subQuorum24HoursAvailability:
				measurement24HourAverage?.isSubQuorumAvailableAvg || 0,
			has30DayStats: measurement30DayAverage !== undefined,
			subQuorum30DaysAvailability:
				measurement30DayAverage?.isSubQuorumAvailableAvg || 0,
			hasReliableUptime: ReliableUptimePolicy.hasReliableUptime(
				organization,
				measurement30DayAverage
			),
			logo: null,
			tomlState: latestAttempt?.state ?? 'Unknown',
			tomlWarnings: latestAttempt?.warnings ?? [],
			tomlLatestAttempt: this.mapTomlAttempt(latestAttempt),
			tomlLatestFailure: this.mapTomlFailure(evidence.latestFailure),
			tomlLatestInsecureAttempt: this.mapTomlAttempt(
				evidence.latestInsecureAttempt
			),
			stellarToml:
				evidence.latestSuccess === null
					? null
					: {
							url: `https://${organization.homeDomain}/.well-known/stellar.toml`,
							content: evidence.latestSuccess.content,
							...(evidence.latestSuccess.observedAt === null
								? {}
								: {
										observedAt: evidence.latestSuccess.observedAt.toISOString()
									}),
							warnings: [...evidence.latestSuccess.warnings]
						}
		};
	}

	private mapTomlAttempt(
		attempt: OrganizationTomlAttempt | null | undefined
	): OrganizationTomlAttemptV1 | null {
		if (attempt === null || attempt === undefined) return null;

		return {
			authoritative: attempt.authoritative,
			contentCaptured: attempt.content !== null,
			observedAt: attempt.observedAt.toISOString(),
			result: attempt.result,
			state: attempt.state,
			warnings: [...attempt.warnings]
		};
	}

	private mapTomlFailure(
		failure: OrganizationTomlFailure | null
	): OrganizationTomlFailureV1 | null {
		if (failure === null) return null;

		return {
			authoritative: false,
			contentCaptured: failure.content !== null,
			observedAt: failure.observedAt.toISOString(),
			result: 'failure',
			state: failure.state,
			warnings: [...failure.warnings]
		};
	}

	private getInMemoryTomlEvidence(
		organization: Organization
	): OrganizationTomlEvidence {
		const latestAttempt =
			organization.latestMeasurement()?.toTomlAttempt() ?? null;
		const successfulContent = organization.stellarTomlText;
		const authoritativeInMemorySuccess =
			latestAttempt?.authoritative === true &&
			latestAttempt.result === 'success' &&
			latestAttempt.content !== null
				? latestAttempt
				: null;

		return {
			latestAttempt,
			latestFailure:
				latestAttempt?.result === 'failure'
					? { ...latestAttempt, result: 'failure' }
					: null,
			latestInsecureAttempt:
				latestAttempt?.warnings.includes(
					'TlsCertificateVerificationDisabled'
				) === true
					? latestAttempt
					: null,
			latestSuccess:
				successfulContent !== null
					? {
							content:
								authoritativeInMemorySuccess?.content ?? successfulContent,
							observedAt: authoritativeInMemorySuccess?.observedAt ?? null,
							warnings: authoritativeInMemorySuccess?.warnings ?? []
						}
					: null
		};
	}

	toOrganizationSnapshotV1DTO(
		organization: Organization
	): OrganizationSnapshotV1 {
		return {
			startDate: organization.snapshotStartDate.toISOString(),
			endDate: organization.snapshotEndDate.toISOString(),
			organization: this.toOrganizationV1DTO(organization)
		};
	}
}
