import { Repository } from 'typeorm';
import NetworkMeasurementMonth from '@network-scan/domain/network/NetworkMeasurementMonth.js';
import { injectable } from 'inversify';
import type { NetworkMeasurementMonthRepository } from '@network-scan/domain/network/NetworkMeasurementMonthRepository.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';

@injectable()
export class TypeOrmNetworkMeasurementMonthRepository implements NetworkMeasurementMonthRepository {
	constructor(private baseRepository: Repository<NetworkMeasurementMonth>) {}

	async save(
		networkMeasurementMonths: NetworkMeasurementMonth[]
	): Promise<NetworkMeasurementMonth[]> {
		return await this.baseRepository.save(networkMeasurementMonths);
	}

	async findBetween(
		networkId: NetworkId,
		from: Date,
		to: Date
	): Promise<NetworkMeasurementMonth[]> {
		const result = await this.baseRepository.query(
			`with measurements as (SELECT *
                                   FROM "network_measurement_month" "NetworkMeasurementMonth"
                                   WHERE "time" >= date_trunc('month', $1::timestamptz)
                                     and "time" <= date_trunc('month', $2::timestamptz))
             select *
             from (select generate_series(date_trunc('month', $1::TIMESTAMPTZ), date_trunc('month', $2::TIMESTAMPTZ),
                                          interval '1 month')) d(month_series)
                      LEFT OUTER JOIN measurements on d.month_series = date_trunc('month', measurements.time)`,
			[from, to]
		);

		return result.map((record: Record<string, string>) => {
			const measurement = new NetworkMeasurementMonth();
			measurement.time = new Date(record.month_series);
			for (const [key, value] of Object.entries(record)) {
				if (key !== 'time' && key !== 'month_series') {
					// @ts-ignore
					measurement[key] = Number(value);
				}
			}
			return measurement;
		});
	}

	async rollup(fromCrawlId: number, toCrawlId: number) {
		await this.baseRepository.query(
			`INSERT INTO network_measurement_month ("time", "nrOfActiveWatchersSum", "nrOfConnectableNodesSum", "nrOfActiveValidatorsSum",
                                                    "nrOfActiveFullValidatorsSum", "nrOfActiveOrganizationsSum",
                                                    "transitiveQuorumSetSizeSum", "hasQuorumIntersectionCount",
                                                    "hasSymmetricTopTierCount", "topTierMin", "topTierMax",
                                                    "topTierOrgsMin", "topTierOrgsMax", "minBlockingSetMin",
                                                    "minBlockingSetMax", "minBlockingSetOrgsMin",
                                                    "minBlockingSetOrgsMax", "minBlockingSetFilteredMin",
                                                    "minBlockingSetFilteredMax", "minBlockingSetOrgsFilteredMin",
                                                    "minBlockingSetOrgsFilteredMax", "minSplittingSetMin",
                                                    "minSplittingSetMax", "minSplittingSetOrgsMin",
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
             with affected_months as (
                 select distinct date_trunc('month', NetworkScan."time") "crawlMonth"
                 from network_scan NetworkScan
                 WHERE NetworkScan.id BETWEEN $1 AND $2
                   and NetworkScan.completed = true
             ),
             bounds as (
                 select min("crawlMonth") "fromTime", max("crawlMonth") + interval '1 month' "toTime"
                 from affected_months
             ),
             scans as (select date_trunc('month', NetworkScan."time") "crawlMonth",
                               count(distinct NetworkScan.id) "crawlCount"
                        from network_scan NetworkScan
                        JOIN bounds on NetworkScan."time" >= bounds."fromTime" and NetworkScan."time" < bounds."toTime"
                        JOIN affected_months on affected_months."crawlMonth" = date_trunc('month', NetworkScan."time")
                        WHERE NetworkScan.completed = true
                        group by date_trunc('month', NetworkScan."time"))
             select date_trunc('month', NetworkScan."time")   "month",
                    sum("nrOfActiveWatchers"::int)                "nrOfActiveWatchersSum",
                    sum("nrOfConnectableNodes"::int)                "nrOfConnectableNodesSum",
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
                    scans."crawlCount" as                       "crawlCount",
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
                      JOIN scans on scans."crawlMonth" = date_trunc('month', NetworkScan."time")
                      JOIN network_measurement on network_measurement."time" = NetworkScan."time"
             WHERE NetworkScan.completed = true
             group by date_trunc('month', NetworkScan."time"), scans."crawlCount"
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
			[fromCrawlId, toCrawlId]
		);
	}
}
