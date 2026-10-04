/**
 * Availability is a sample-weighted observation, not an estimate for unobserved
 * time. Incomplete scans, missing network evidence and zero-active-validator
 * scans are indeterminate. Partial validator failures still count, even when
 * every organization has lost its own subquorum threshold.
 * Read raw evidence so older rollups cannot reintroduce invalid observations.
 */
export const organizationObservedAvailabilitySql = `
with observed as materialized (
  select measurement.time, measurement."organizationId",
         measurement."isSubQuorumAvailable"
  from organization_measurement measurement
  join network_scan scan on scan.time = measurement.time and scan.completed
  join network_measurement network on network.time = scan.time
       and network."nrOfActiveValidators" > 0
  where measurement.time > $1::timestamptz
    and measurement.time <= $2::timestamptz
)
select organization."organizationIdValue" as "organizationId",
       round(100.0 * avg(observed."isSubQuorumAvailable"::int), 2)
         as "isSubQuorumAvailableAvg",
       count(*)::int as "observedScans",
       count(distinct (observed.time at time zone 'UTC')::date)::int
         as "observedDays"
from observed
join organization on organization.id = observed."organizationId"
group by organization."organizationIdValue"`;
