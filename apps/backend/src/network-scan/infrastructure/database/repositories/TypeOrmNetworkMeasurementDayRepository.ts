import { Repository } from 'typeorm';
import NetworkMeasurementDay from '@network-scan/domain/network/NetworkMeasurementDay.js';
import { injectable } from 'inversify';
import type {
	NetworkMeasurementDayRepository,
	NetworkScanRollupDaySummary
} from '@network-scan/domain/network/NetworkMeasurementDayRepository.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';

@injectable()
export class TypeOrmNetworkMeasurementDayRepository implements NetworkMeasurementDayRepository {
	constructor(private baseRepository: Repository<NetworkMeasurementDay>) {}

	async save(networkMeasurementDays: NetworkMeasurementDay[]) {
		return await this.baseRepository.save(networkMeasurementDays);
	}

	async findScanRollupSummary(
		from: Date,
		to: Date
	): Promise<NetworkScanRollupDaySummary[]> {
		const result = await this.baseRepository.query(
			`with days as (
				 select generate_series(
					 date_trunc('day', $1::timestamptz),
					 date_trunc('day', $2::timestamptz) - interval '1 day',
					 interval '1 day'
				 ) as "day"
			 ),
			 raw_scans as (
				 select date_trunc('day', "time") as "day", count(*) as "rawCompletedScans"
				 from "network_scan"
				 where "time" >= date_trunc('day', $1::timestamptz)
				   and "time" < date_trunc('day', $2::timestamptz)
				   and completed = true
				 group by date_trunc('day', "time")
			 )
			 select days."day" as "day",
					coalesce(raw_scans."rawCompletedScans", 0) as "rawCompletedScans",
					rollups."crawlCount" as "rollupCrawlCount"
			 from days
			 left join raw_scans on raw_scans."day" = days."day"
			 left join "network_measurement_day" rollups on rollups."time" = days."day"::date
			 order by days."day" asc`,
			[from, to]
		);

		return result.map((record: Record<string, string | Date | null>) => ({
			day: toDate(record.day),
			rawCompletedScans: Number(
				record.rawCompletedScans ?? record.rawcompletedscans ?? 0
			),
			rollupCrawlCount:
				record.rollupCrawlCount === null ||
				record.rollupcrawlcount === null ||
				(record.rollupCrawlCount === undefined &&
					record.rollupcrawlcount === undefined)
					? null
					: Number(record.rollupCrawlCount ?? record.rollupcrawlcount)
		}));
	}

	async findBetween(
		networkId: NetworkId,
		from: Date,
		to: Date
	): Promise<NetworkMeasurementDay[]> {
		const result = await this.baseRepository.query(
			`with measurements as (SELECT *
								   FROM "network_measurement_day" "NetworkMeasurementDay"
								   WHERE "time" >= date_trunc('day', $1::timestamptz)
									 and "time" <= date_trunc('day', $2::timestamptz))
			 select *
			 from (select generate_series(date_trunc('day', $1::TIMESTAMPTZ), date_trunc('day', $2::TIMESTAMPTZ),
										  interval '1 day')) d(day_series)
					  LEFT OUTER JOIN measurements on d.day_series = measurements.time`,
			[from, to]
		);

		return result.map((record: Record<string, string>) => {
			const measurement = new NetworkMeasurementDay();
			measurement.time = new Date(record.day_series);
			for (const [key, value] of Object.entries(record)) {
				if (key !== 'time' && key !== 'day_series') {
					// @ts-ignore
					measurement[key] = Number(value);
				}
			}
			return measurement;
		});
	}

	async rollup(fromNetworkScanId: number, toNetworkScanId: number) {
		await this.baseRepository.query(
			`INSERT INTO network_measurement_day ("time", "nrOfActiveWatchersSum", "nrOfConnectableNodesSum", "nrOfActiveValidatorsSum",
												  "nrOfActiveFullValidatorsSum", "nrOfActiveOrganizationsSum",
												  "transitiveQuorumSetSizeSum", "hasQuorumIntersectionCount",
												  "hasSymmetricTopTierCount", "topTierMin", "topTierMax",
												  "topTierOrgsMin", "topTierOrgsMax", "minBlockingSetMin",
												  "minBlockingSetMax", "minBlockingSetOrgsMin", "minBlockingSetOrgsMax",
												  "minBlockingSetFilteredMin", "minBlockingSetFilteredMax",
												  "minBlockingSetOrgsFilteredMin", "minBlockingSetOrgsFilteredMax",
												  "minSplittingSetMin", "minSplittingSetMax", "minSplittingSetOrgsMin",
												  "minSplittingSetOrgsMax", "crawlCount", "topTierSum",
												  "topTierOrgsSum", "minBlockingSetSum", "minBlockingSetOrgsSum",
												  "minBlockingSetFilteredSum", "minBlockingSetOrgsFilteredSum",
												  "minSplittingSetSum", "minSplittingSetOrgsSum",
												  "hasTransitiveQuorumSetCount", "minBlockingSetCountryMin",
												  "minBlockingSetCountryMax", "minBlockingSetCountryFilteredMin",
												  "minBlockingSetCountryFilteredMax", "minBlockingSetCountrySum",
												  "minBlockingSetCountryFilteredSum", "minBlockingSetISPMin",
												  "minBlockingSetISPMax", "minBlockingSetISPFilteredMin",
												  "minBlockingSetISPFilteredMax", "minBlockingSetISPSum",
												  "minBlockingSetISPFilteredSum", "minSplittingSetCountryMin",
												  "minSplittingSetCountryMax", "minSplittingSetCountrySum",
												  "minSplittingSetISPMin", "minSplittingSetISPMax",
												  "minSplittingSetISPSum")
			 with affected_days as (
				 select distinct date_trunc('day', NetworkScan."time") "crawlDay"
				 from network_scan NetworkScan
				 WHERE NetworkScan.id BETWEEN $1 AND $2
				   and NetworkScan.completed = true
			 ),
			 bounds as (
				 select min("crawlDay") "fromTime", max("crawlDay") + interval '1 day' "toTime"
				 from affected_days
			 ),
			 updates as (select date_trunc('day', NetworkScan."time") "crawlDay",
								 count(distinct NetworkScan.id) "crawlCount"
						  from network_scan NetworkScan
						  JOIN bounds on NetworkScan."time" >= bounds."fromTime" and NetworkScan."time" < bounds."toTime"
						  JOIN affected_days on affected_days."crawlDay" = date_trunc('day', NetworkScan."time")
						  WHERE NetworkScan.completed = true
						  group by date_trunc('day', NetworkScan."time"))
			 select date_trunc('day', NetworkScan."time")     "day",
					sum("nrOfActiveWatchers"::int)                "nrOfActiveWatchersSum",
					sum("nrOfConnectableNodes"::int)              "nrOfConnectableNodesSum",
					sum("nrOfActiveValidators"::int)              "nrOfActiveValidatorsSum",
					sum("nrOfActiveFullValidators"::int)          "nrOfActiveFullValidatorsSum",
					sum("nrOfActiveOrganizations"::int)           "nrOfActiveOrganizationsSum",
					sum("transitiveQuorumSetSize"::int)           "transitiveQuorumSetSizeSum",
					sum("hasQuorumIntersection"::int)             "hasQuorumIntersectionCount",
					sum("hasSymmetricTopTier"::int)               "hasSymmetricTopTierCount",
					min("topTierSize"::int)                       "topTierMin",
					max("topTierSize"::int)                       "topTierMax",
					min("topTierOrgsSize"::int)                   "topTierOrgsMin",
					max("topTierOrgsSize"::int)                   "topTierOrgsMax",
					min("minBlockingSetSize"::int)                "minBlockingSetMin",
					max("minBlockingSetSize"::int)                "minBlockingSetMax",
					min("minBlockingSetOrgsSize"::int)            "minBlockingSetOrgsMin",
					max("minBlockingSetOrgsSize"::int)            "minBlockingSetOrgsMax",
					min("minBlockingSetFilteredSize"::int)        "minBlockingSetFilteredMin",
					max("minBlockingSetFilteredSize"::int)        "minBlockingSetFilteredMax",
					min("minBlockingSetOrgsFilteredSize"::int)    "minBlockingSetOrgsFilteredMin",
					max("minBlockingSetOrgsFilteredSize"::int)    "minBlockingSetOrgsFilteredMax",
					min("minSplittingSetSize"::int)               "minSplittingSetMin",
					max("minSplittingSetSize"::int)               "minSplittingSetMax",
					min("minSplittingSetOrgsSize"::int)           "minSplittingSetOrgsMin",
					max("minSplittingSetOrgsSize"::int)           "minSplittingSetOrgsMax",
					updates."crawlCount" as                       "crawlCount",
					sum("topTierSize"::int)                       "topTierSum",
					sum("topTierOrgsSize"::int)                   "topTierOrgsSum",
					sum("minBlockingSetSize"::int)                "minBlockingSetSum",
					sum("minBlockingSetOrgsSize"::int)            "minBlockingSetOrgsSum",
					sum("minBlockingSetFilteredSize"::int)        "minBlockingSetFilteredSum",
					sum("minBlockingSetOrgsFilteredSize"::int)    "minBlockingSetOrgsFilteredSum",
					sum("minSplittingSetSize"::int)               "minSplittingSetSum",
					sum("minSplittingSetOrgsSize"::int)           "minSplittingSetOrgsSum",
					sum("hasTransitiveQuorumSet"::int)            "hasTransitiveQuorumSetCount",
					min("minBlockingSetCountrySize"::int)         "minBlockingSetCountryMin",
					max("minBlockingSetCountrySize"::int)         "minBlockingSetCountryMax",
					min("minBlockingSetCountryFilteredSize"::int) "minBlockingSetCountryFilteredMin",
					max("minBlockingSetCountryFilteredSize"::int) "minBlockingSetCountryFilteredMax",
					sum("minBlockingSetCountrySize"::int)         "minBlockingSetCountrySum",
					sum("minBlockingSetCountryFilteredSize"::int) "minBlockingSetCountryFilteredSum",
					min("minBlockingSetISPSize"::int)             "minBlockingSetISPMin",
					max("minBlockingSetISPSize"::int)             "minBlockingSetISPMax",
					min("minBlockingSetISPFilteredSize"::int)     "minBlockingSetISPFilteredMin",
					max("minBlockingSetISPFilteredSize"::int)     "minBlockingSetISPFilteredMax",
					sum("minBlockingSetISPSize"::int)             "minBlockingSetISPSum",
					sum("minBlockingSetISPFilteredSize"::int)     "minBlockingSetISPFilteredSum",
					min("minSplittingSetCountrySize"::int)        "minSplittingSetCountryMin",
					max("minSplittingSetCountrySize"::int)        "minSplittingSetCountryMax",
					sum("minSplittingSetCountrySize"::int)        "minSplittingSetCountrySum",
					min("minSplittingSetISPSize"::int)            "minSplittingSetISPMin",
					max("minSplittingSetISPSize"::int)            "minSplittingSetISPMax",
					sum("minSplittingSetISPSize"::int)            "minSplittingSetISPSum"
			 FROM "network_scan" NetworkScan
					  JOIN bounds on NetworkScan."time" >= bounds."fromTime" and NetworkScan."time" < bounds."toTime"
					  JOIN updates on updates."crawlDay" = date_trunc('day', NetworkScan."time")
					  JOIN network_measurement on network_measurement."time" = NetworkScan."time"
			 WHERE NetworkScan.completed = true
			 group by date_trunc('day', NetworkScan."time"), updates."crawlCount"
			 ON CONFLICT (time) DO UPDATE
				 SET "nrOfActiveWatchersSum"            = EXCLUDED."nrOfActiveWatchersSum",
					"nrOfConnectableNodesSum"            = EXCLUDED."nrOfConnectableNodesSum",
					 "nrOfActiveValidatorsSum"          = EXCLUDED."nrOfActiveValidatorsSum",
					 "nrOfActiveFullValidatorsSum"      = EXCLUDED."nrOfActiveFullValidatorsSum",
					 "nrOfActiveOrganizationsSum"       = EXCLUDED."nrOfActiveOrganizationsSum",
					 "transitiveQuorumSetSizeSum"       = EXCLUDED."transitiveQuorumSetSizeSum",
					 "hasQuorumIntersectionCount"       = EXCLUDED."hasQuorumIntersectionCount",
					 "hasSymmetricTopTierCount"         = EXCLUDED."hasSymmetricTopTierCount",
					 "hasTransitiveQuorumSetCount"      = EXCLUDED."hasTransitiveQuorumSetCount",
					 "topTierMin"                       = EXCLUDED."topTierMin",
					 "topTierMax"                       = EXCLUDED."topTierMax",
					 "topTierOrgsMin"                   = EXCLUDED."topTierOrgsMin",
					 "topTierOrgsMax"                   = EXCLUDED."topTierOrgsMax",
					 "minBlockingSetMin"                = EXCLUDED."minBlockingSetMin",
					 "minBlockingSetMax"                = EXCLUDED."minBlockingSetMax",
					 "minBlockingSetFilteredMin"        = EXCLUDED."minBlockingSetFilteredMin",
					 "minBlockingSetFilteredMax"        = EXCLUDED."minBlockingSetFilteredMax",
					 "minBlockingSetOrgsMin"            = EXCLUDED."minBlockingSetOrgsMin",
					 "minBlockingSetOrgsMax"            = EXCLUDED."minBlockingSetOrgsMax",
					 "minBlockingSetOrgsFilteredMin"    = EXCLUDED."minBlockingSetOrgsFilteredMin",
					 "minBlockingSetOrgsFilteredMax"    = EXCLUDED."minBlockingSetOrgsFilteredMax",
					 "minSplittingSetMin"               = EXCLUDED."minSplittingSetMin",
					 "minSplittingSetMax"               = EXCLUDED."minSplittingSetMax",
					 "minSplittingSetOrgsMin"           = EXCLUDED."minSplittingSetOrgsMin",
					 "minSplittingSetOrgsMax"           = EXCLUDED."minSplittingSetOrgsMax",
					 "topTierSum"                       = EXCLUDED."topTierSum",
					 "topTierOrgsSum"                   = EXCLUDED."topTierOrgsSum",
					 "minBlockingSetSum"                = EXCLUDED."minBlockingSetSum",
					 "minBlockingSetOrgsSum"            = EXCLUDED."minBlockingSetOrgsSum",
					 "minBlockingSetFilteredSum"        = EXCLUDED."minBlockingSetFilteredSum",
					 "minBlockingSetOrgsFilteredSum"    = EXCLUDED."minBlockingSetOrgsFilteredSum",
					 "minSplittingSetSum"               = EXCLUDED."minSplittingSetSum",
					 "minSplittingSetOrgsSum"           = EXCLUDED."minSplittingSetOrgsSum",
					 "minBlockingSetCountryMin"         = EXCLUDED."minBlockingSetCountryMin",
					 "minBlockingSetCountryMax"         = EXCLUDED."minBlockingSetCountryMax",
					 "minBlockingSetCountryFilteredMin" = EXCLUDED."minBlockingSetCountryFilteredMin",
					 "minBlockingSetCountryFilteredMax" = EXCLUDED."minBlockingSetCountryFilteredMax",
					 "minBlockingSetCountrySum"         = EXCLUDED."minBlockingSetCountrySum",
					 "minBlockingSetCountryFilteredSum" = EXCLUDED."minBlockingSetCountryFilteredSum",
					 "minBlockingSetISPMin"             = EXCLUDED."minBlockingSetISPMin",
					 "minBlockingSetISPMax"             = EXCLUDED."minBlockingSetISPMax",
					 "minBlockingSetISPFilteredMin"     = EXCLUDED."minBlockingSetISPFilteredMin",
					 "minBlockingSetISPFilteredMax"     = EXCLUDED."minBlockingSetISPFilteredMax",
					 "minBlockingSetISPSum"             = EXCLUDED."minBlockingSetISPSum",
					 "minBlockingSetISPFilteredSum"     = EXCLUDED."minBlockingSetISPFilteredSum",
					 "minSplittingSetCountryMin"        = EXCLUDED."minSplittingSetCountryMin",
					 "minSplittingSetCountryMax"        = EXCLUDED."minSplittingSetCountryMax",
					 "minSplittingSetCountrySum"        = EXCLUDED."minSplittingSetCountrySum",
					 "minSplittingSetISPMin"            = EXCLUDED."minSplittingSetISPMin",
					 "minSplittingSetISPMax"            = EXCLUDED."minSplittingSetISPMax",
					 "minSplittingSetISPSum"            = EXCLUDED."minSplittingSetISPSum",
					 "crawlCount"                       = EXCLUDED."crawlCount"`,
			[fromNetworkScanId, toNetworkScanId]
		);
	}
}

function toDate(value: string | Date | null): Date {
	if (value instanceof Date) return value;
	return new Date(value ?? 0);
}
