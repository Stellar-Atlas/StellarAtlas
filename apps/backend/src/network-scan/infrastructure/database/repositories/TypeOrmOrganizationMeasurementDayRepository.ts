import { Between, Repository } from 'typeorm';
import OrganizationMeasurementDay from '../../../domain/organization/OrganizationMeasurementDay.js';
import { injectable } from 'inversify';
import { OrganizationMeasurementAverage } from '../../../domain/organization/OrganizationMeasurementAverage.js';
import {
	organizationMeasurementAverageFromDatabaseRecord,
	OrganizationMeasurementAverageRecord
} from './TypeOrmOrganizationMeasurementRepository.js';
import type { OrganizationMeasurementDayRepository } from '../../../domain/organization/OrganizationMeasurementDayRepository.js';
import { OrganizationId } from '../../../domain/organization/OrganizationId.js';

@injectable()
export class TypeOrmOrganizationMeasurementDayRepository implements OrganizationMeasurementDayRepository {
	constructor(private baseRepository: Repository<OrganizationMeasurementDay>) {}

	async save(
		organizationMeasurementDays: OrganizationMeasurementDay[]
	): Promise<OrganizationMeasurementDay[]> {
		return await this.baseRepository.save(organizationMeasurementDays);
	}

	async findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<OrganizationMeasurementAverage[]> {
		const from = new Date(at.getTime());
		from.setDate(at.getDate() - xDays);

		const result = await this.baseRepository.query(
			`select "organizationIdValue"                                              as "organizationId",
					ROUND(100.0 * (sum("isSubQuorumAvailableCount"::int::decimal) / sum("crawlCount")),
						  2)                                                      as "isSubQuorumAvailableAvg",
					ROUND((sum("indexSum"::int::decimal) / sum("crawlCount")), 2) as "indexAvg"
			 FROM "organization_measurement_day" "OrganizationMeasurementDay"
			 join "organization" "Organization" on "Organization"."id" = "OrganizationMeasurementDay"."organizationId"
			 WHERE time >= date_trunc('day', $1::TIMESTAMP)
			   and time <= date_trunc('day', $2::TIMESTAMP)
			 GROUP BY "organizationIdValue"
			 having count("organizationId") >= $3`, //needs at least a record every day in the range, or the average is NA
			[from, at, xDays]
		);

		return result.map((record: OrganizationMeasurementAverageRecord) =>
			organizationMeasurementAverageFromDatabaseRecord(record)
		);
	}

	async findBetween(organizationId: OrganizationId, from: Date, to: Date) {
		return await this.baseRepository
			.createQueryBuilder('ma')
			.innerJoinAndSelect(
				'ma.organization',
				'org',
				'org.organizationIdValue= :organizationIdValue',
				{ organizationIdValue: organizationId.value }
			)
			.where({
				_time: Between(from, to)
			})
			.orderBy({
				time: 'ASC'
			})
			.getMany();
	}

	async rollup(fromCrawlId: number, toCrawlId: number) {
		await this.baseRepository.query(
			`INSERT INTO organization_measurement_day (time, "organizationId", "isSubQuorumAvailableCount",
                                                       "indexSum", "crawlCount")
             with affected_days as (
                 select distinct date_trunc('day', NetworkScan."time") "crawlDay"
                 from network_scan NetworkScan
                 WHERE NetworkScan.id BETWEEN $1 and $2
                   and NetworkScan.completed = true
             ),
             bounds as (
                 select min("crawlDay") "fromTime", max("crawlDay") + interval '1 day' "toTime"
                 from affected_days
             )
             select date_trunc('day', "NetworkScan"."time") "day",
                    "organizationId",
                    sum("isSubQuorumAvailable"::int)          "isSubQuorumAvailableCount",
                    sum("index"::int)                         "indexSum",
                    count(distinct "NetworkScan".id)          as "crawlCount"
             FROM "network_scan" "NetworkScan"
                      join bounds
                           on "NetworkScan"."time" >= bounds."fromTime" and "NetworkScan"."time" < bounds."toTime"
                      join organization_measurement on organization_measurement."time" = "NetworkScan".time
             WHERE "NetworkScan".completed = true
             group by date_trunc('day', "NetworkScan"."time"), "organizationId"
             ON CONFLICT (time, "organizationId") DO UPDATE
                 SET "isSubQuorumAvailableCount" = EXCLUDED."isSubQuorumAvailableCount",
                     "indexSum"                  = EXCLUDED."indexSum",
                     "crawlCount"                = EXCLUDED."crawlCount"`,
			[fromCrawlId, toCrawlId]
		);
	}
}
