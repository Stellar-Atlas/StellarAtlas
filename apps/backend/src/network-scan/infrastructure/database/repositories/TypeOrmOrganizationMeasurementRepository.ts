import { Between, EntityRepository, Repository } from 'typeorm';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import { injectable } from 'inversify';
import type { OrganizationMeasurementRepository } from '@network-scan/domain/organization/OrganizationMeasurementRepository.js';
import { OrganizationMeasurementAverage } from '@network-scan/domain/organization/OrganizationMeasurementAverage.js';
import { OrganizationMeasurementEvent } from '@network-scan/domain/organization/OrganizationMeasurementEvent.js';
import { saveOrganizationMeasurement } from './OrganizationTomlEvidencePersistence.js';
import { findOrganizationTomlEvidenceAt } from './OrganizationTomlEvidenceRead.js';
import { organizationObservedAvailabilitySql } from './OrganizationObservedAvailabilitySql.js';

export interface OrganizationMeasurementAverageRecord {
	organizationId: string;
	isSubQuorumAvailableAvg: string;
	observedDays?: number;
	observedScans?: number;
}
export function organizationMeasurementAverageFromDatabaseRecord(
	record: OrganizationMeasurementAverageRecord
): OrganizationMeasurementAverage {
	return {
		organizationId: record.organizationId,
		isSubQuorumAvailableAvg: Number(record.isSubQuorumAvailableAvg),
		...(record.observedDays === undefined || record.observedScans === undefined
			? {}
			: {
					coverage: {
						observedDays: Number(record.observedDays),
						observedScans: Number(record.observedScans)
					}
				})
	};
}

@injectable()
export class TypeOrmOrganizationMeasurementRepository implements OrganizationMeasurementRepository {
	constructor(private baseRepository: Repository<OrganizationMeasurement>) {}

	async save(
		organizationMeasurements: OrganizationMeasurement[]
	): Promise<void> {
		if (organizationMeasurements.length === 0) return;
		await this.baseRepository.manager.transaction(async (entityManager) => {
			for (const measurement of organizationMeasurements) {
				await saveOrganizationMeasurement(
					entityManager,
					measurement.organization,
					measurement
				);
			}
		});
	}

	async findBetween(
		organizationId: string,
		from: Date,
		to: Date
	): Promise<OrganizationMeasurement[]> {
		return await this.baseRepository
			.createQueryBuilder('measurement')
			.innerJoinAndSelect(
				'measurement.organization',
				'organization',
				'organization.organizationIdValue = :organizationId',
				{ organizationId }
			)
			.where([
				{
					time: Between(from, to)
				}
			])
			.orderBy({
				time: 'ASC'
			})
			.getMany();
	}

	async findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<OrganizationMeasurementAverage[]> {
		const from = new Date(at.getTime() - xDays * 86_400_000);

		const result = await this.baseRepository.query(
			organizationObservedAvailabilitySql,
			[from, at]
		);

		return result.map((record: OrganizationMeasurementAverageRecord) =>
			organizationMeasurementAverageFromDatabaseRecord(record)
		);
	}

	async findTomlEvidenceAt(organizationIds: string[], at: Date) {
		return findOrganizationTomlEvidenceAt(
			this.baseRepository.manager,
			organizationIds,
			at
		);
	}

	async findEventsForXNetworkScans(
		x: number,
		at: Date
	): Promise<OrganizationMeasurementEvent[]> {
		return await this.baseRepository.query(
			`select max(c."time") as   time, "oi"."organizationIdValue" as "organizationId",
					(case
						 when count(case when "isSubQuorumAvailable" = true then 1 end) = 1
							 and max(case when "isSubQuorumAvailable" = true then c.nr else 0 end) = $1
							 then true
						 else false end) "subQuorumUnavailable",
					(case
						 when count(case when "tomlState" = 'Ok' then 1 end) = 1
							 and max(case when "tomlState" = 'Ok' then c.nr else 0 end) = $1
							 then true
						 else false end) "tomlIssue"
			 from organization_measurement om
					  join lateral ( select row_number() over (order by time desc) as nr, time
									 from network_scan 
									 where completed = true and time <= $2::timestamptz
									 order by time desc
									 limit $1
				 ) c
						   on c.time = om.time
					  join organization oi on om."organizationId" = oi."id"
			 group by oi."organizationIdValue"
			 having count(case when "isSubQuorumAvailable" = true then 1 end) = 1
				and max(case when "isSubQuorumAvailable" = true then c.nr else 0 end) = $1
			or count(case when "tomlState" = 'Ok' then 1 end) = 1
				 and max(case when "tomlState" = 'Ok' then c.nr else 0 end) = $1`,
			[x + 1, at]
		);
	}

	async findAllAt(at: Date): Promise<OrganizationMeasurement[]> {
		return await this.baseRepository.find({
			where: {
				time: at
			}
		});
	}

	async findAt(id: string, at: Date): Promise<OrganizationMeasurement | null> {
		throw new Error('Method not implemented.');
	}
}
