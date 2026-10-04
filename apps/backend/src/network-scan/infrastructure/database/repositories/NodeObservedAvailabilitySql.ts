const dayMs = 86_400_000;

/** Exact (from, at] windows, independent of local timezone/DST. */
export function nodeAvailabilityWindow(at: Date, days: number): Date[] {
	if (
		!Number.isFinite(at.getTime()) ||
		!Number.isInteger(days) ||
		days < 1 ||
		days > 30
	)
		throw new RangeError(
			'Node availability requires a valid date and 1–30 days'
		);
	const from = new Date(at.getTime() - days * dayMs);
	const firstFullDay = new Date(
		Math.floor(from.getTime() / dayMs) * dayMs + dayMs
	);
	const lastFullDay = new Date(Math.floor(at.getTime() / dayMs) * dayMs);
	return [from, at, firstFullDay, lastFullDay];
}

/**
 * Reuse small daily rollups only when every completed scan in that UTC day has
 * positive-validator network evidence. Older mixed-health rollups cannot be
 * disentangled safely: omit them as missing coverage, never as node downtime.
 * Only the two partial boundary days read raw node measurements. No request
 * reparses a 30-day raw window or rewrites historical rollups.
 */
export const nodeObservedAvailabilitySql = `
with healthy_full_days as materialized (
  select (scan.time at time zone 'UTC')::date as day,
         count(*) as "healthyScans"
  from network_scan scan
  left join network_measurement network on network.time = scan.time
  where scan.time >= $3::timestamptz and scan.time < $4::timestamptz
    and scan.completed
  group by (scan.time at time zone 'UTC')::date
  having bool_and(coalesce(network."nrOfActiveValidators" > 0, false))
), boundary_observations as (
  select measurement.*
  from node_measurement_v2 measurement
  join network_scan scan on scan.time = measurement.time and scan.completed
  join network_measurement network on network.time = scan.time
       and network."nrOfActiveValidators" > 0
  where measurement.time > $1::timestamptz and measurement.time < $3::timestamptz
  union all
  select measurement.*
  from node_measurement_v2 measurement
  join network_scan scan on scan.time = measurement.time and scan.completed
  join network_measurement network on network.time = scan.time
       and network."nrOfActiveValidators" > 0
  where measurement.time >= $4::timestamptz and measurement.time <= $2::timestamptz
), observed_days as (
  select measurement."nodeId", (measurement.time at time zone 'UTC')::date as day,
         sum(measurement."isActive"::int) as active,
         sum(measurement."isValidating"::int) as validating,
         sum(measurement."isFullValidator"::int) as full_validator,
         sum(measurement."isOverLoaded"::int) as overloaded,
         sum(measurement."historyArchiveHasError"::int) as archive_error,
         sum(measurement."index"::int) as index_sum, count(*) as samples
  from boundary_observations measurement
  group by measurement."nodeId", (measurement.time at time zone 'UTC')::date
  union all
  select rollup."nodeId", rollup.time, rollup."isActiveCount",
         rollup."isValidatingCount", rollup."isFullValidatorCount",
         rollup."isOverloadedCount", rollup."historyArchiveErrorCount",
         rollup."indexSum", rollup."crawlCount"
  from node_measurement_day_v2 rollup
  join healthy_full_days healthy on healthy.day = rollup.time
  where rollup.time >= ($3::timestamptz at time zone 'UTC')::date
    and rollup.time < ($4::timestamptz at time zone 'UTC')::date
    and rollup."crawlCount" > 0 and rollup."crawlCount" <= healthy."healthyScans"
)
select node."publicKeyValue" as "publicKey",
       round(100.0 * sum(active) / sum(samples), 2) as "activeAvg",
       round(100.0 * sum(validating) / sum(samples), 2) as "validatingAvg",
       round(100.0 * sum(full_validator) / sum(samples), 2) as "fullValidatorAvg",
       round(100.0 * sum(overloaded) / sum(samples), 2) as "overLoadedAvg",
       round(100.0 * sum(archive_error) / sum(samples), 2) as "historyArchiveErrorAvg",
       round(sum(index_sum)::numeric / sum(samples), 2) as "indexAvg",
       sum(samples)::int as "observedScans", count(*)::int as "observedDays"
from observed_days
join node on node.id = observed_days."nodeId"
group by node."publicKeyValue"`;
