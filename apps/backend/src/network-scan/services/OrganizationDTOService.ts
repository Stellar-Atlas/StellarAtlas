import Organization from '../domain/organization/Organization.js';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../core/utilities/mapUnknownToError.js';
import type { OrganizationMeasurementRepository } from '../domain/organization/OrganizationMeasurementRepository.js';
import type { OrganizationMeasurementDayRepository } from '../domain/organization/OrganizationMeasurementDayRepository.js';
import { inject, injectable } from 'inversify';
import { NETWORK_TYPES } from '../infrastructure/di/di-types.js';
import { OrganizationV1 } from 'shared';
import { OrganizationV1DTOMapper } from '../mappers/OrganizationV1DTOMapper.js';
import type {
	OrganizationTomlEvidence,
	OrganizationTomlEvidenceRecord
} from '../domain/organization/scan/OrganizationTomlAttempt.js';

@injectable()
export class OrganizationDTOService {
	constructor(
		@inject(NETWORK_TYPES.OrganizationMeasurementRepository)
		private organizationMeasurementRepository: OrganizationMeasurementRepository,
		@inject(NETWORK_TYPES.OrganizationMeasurementDayRepository)
		private organizationMeasurementDayRepository: OrganizationMeasurementDayRepository,
		private organizationMapper: OrganizationV1DTOMapper
	) {}

	public async getOrganizationDTOs(
		time: Date,
		organizations: Organization[]
	): Promise<Result<OrganizationV1[], Error>> {
		try {
			const organizationIds = organizations.map(
				(organization) => organization.organizationId.value
			);
			const [
				measurement24HourAverages,
				measurement30DayAverages,
				persistedTomlEvidence
			] = await Promise.all([
				this.organizationMeasurementRepository.findXDaysAverageAt(time, 1),
				this.organizationMeasurementDayRepository.findXDaysAverageAt(time, 30),
				this.organizationMeasurementRepository.findTomlEvidenceAt(
					organizationIds,
					time
				)
			]); //24 hours can be calculated 'live' quickly
			const measurement24HourAveragesMap = new Map(
				measurement24HourAverages.map((avg) => {
					return [avg.organizationId, avg];
				})
			);

			const measurement30DayAveragesMap = new Map(
				measurement30DayAverages.map((avg) => {
					return [avg.organizationId, avg];
				})
			);
			const tomlEvidenceMap = new Map(
				persistedTomlEvidence.map((evidence) => [
					evidence.organizationId,
					evidence
				])
			);

			return ok(
				organizations.map((organization) => {
					return this.organizationMapper.toOrganizationV1DTO(
						organization,
						measurement24HourAveragesMap.get(organization.organizationId.value),
						measurement30DayAveragesMap.get(organization.organizationId.value),
						this.mergeTomlEvidence(
							organization,
							tomlEvidenceMap.get(organization.organizationId.value),
							time
						)
					);
				})
			);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	private mergeTomlEvidence(
		organization: Organization,
		persisted: OrganizationTomlEvidenceRecord | undefined,
		at: Date
	): OrganizationTomlEvidence {
		let latestAttempt = persisted?.latestAttempt ?? null;
		let latestFailure = persisted?.latestFailure ?? null;
		let latestInsecureAttempt = persisted?.latestInsecureAttempt ?? null;
		let latestSuccess =
			persisted?.latestSuccess ?? this.getLegacySuccess(organization);
		const inMemoryAttempt = organization.latestMeasurement()?.toTomlAttempt();

		if (
			inMemoryAttempt === undefined ||
			inMemoryAttempt === null ||
			inMemoryAttempt.observedAt.getTime() > at.getTime() ||
			!this.isNewerAttempt(inMemoryAttempt, latestAttempt)
		) {
			return {
				latestAttempt,
				latestFailure,
				latestInsecureAttempt,
				latestSuccess
			};
		}

		latestAttempt = inMemoryAttempt;
		if (inMemoryAttempt.authoritative && inMemoryAttempt.result === 'success') {
			const content = inMemoryAttempt.content ?? organization.stellarTomlText;
			if (content !== null) {
				latestSuccess = {
					content,
					observedAt: inMemoryAttempt.observedAt,
					warnings: [...inMemoryAttempt.warnings]
				};
			}
		} else if (
			inMemoryAttempt.result === 'failure' &&
			this.isNewerAttempt(inMemoryAttempt, latestFailure)
		) {
			latestFailure = { ...inMemoryAttempt, result: 'failure' };
		}
		if (
			inMemoryAttempt.warnings.includes('TlsCertificateVerificationDisabled') &&
			this.isNewerAttempt(inMemoryAttempt, latestInsecureAttempt)
		) {
			latestInsecureAttempt = inMemoryAttempt;
		}

		return {
			latestAttempt,
			latestFailure,
			latestInsecureAttempt,
			latestSuccess
		};
	}

	private getLegacySuccess(
		organization: Organization
	): OrganizationTomlEvidence['latestSuccess'] {
		if (organization.stellarTomlText === null) return null;
		return {
			content: organization.stellarTomlText,
			observedAt: null,
			warnings: []
		};
	}

	private isNewerAttempt(
		candidate: NonNullable<OrganizationTomlEvidence['latestAttempt']>,
		current: OrganizationTomlEvidence['latestAttempt']
	): boolean {
		if (current === null) return true;
		const timeDifference =
			candidate.observedAt.getTime() - current.observedAt.getTime();
		if (timeDifference !== 0) return timeDifference > 0;
		return BigInt(candidate.sequence ?? '0') > BigInt(current.sequence ?? '0');
	}
}
