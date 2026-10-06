import { historyArchiveCanonicalFirstScopeSelectSql } from './HistoryArchiveCanonicalFirst.js';

const us = (value: string): string =>
	`(extract(epoch from ${value})*1000000)::bigint::text`;
const metadataColumns = [
	'hostIdentity',
	'objectType',
	'checkpointLedger',
	'objectOrder',
	'status',
	'attempts',
	'executionDisposition',
	'dependencyReady',
	'transitionEffectsRequiredAt',
	'transitionEffectsCompletedAt',
	'nextAttemptAt'
] as const;

/** Missing projection rows require only the page's exact queue primary keys.
 * Do not hydrate/write here; an absent durable object cannot authorize a job. */
const metadata = `left join history_archive_broker_candidate candidate
  on candidate."remoteId"=ready."objectRemoteId"
left join lateral (
  select ${metadataColumns.map((column) => `object."${column}"`).join(',')}
  from history_archive_object_queue object
  where candidate."remoteId" is null and object."remoteId"=ready."objectRemoteId" limit 1
) fallback on true
cross join lateral (select ${metadataColumns
	.map(
		(column) =>
			`case when candidate."remoteId" is not null then candidate."${column}" else fallback."${column}" end as "${column}"`
	)
	.join(',')}) object`;

const candidateFields = `ready."objectRemoteId" as "remoteId",ready."archiveUrlIdentity",
  object."hostIdentity",object."objectType",object."checkpointLedger",object."objectOrder",
  object.status,object.attempts,object."executionDisposition",object."dependencyReady",
  ${us('object."transitionEffectsRequiredAt"')} as "transitionEffectsRequiredAtUs",
  ${us('object."transitionEffectsCompletedAt"')} as "transitionEffectsCompletedAtUs",
  ${us('object."nextAttemptAt"')} as "nextAttemptAtUs",
  ready.priority,${us('ready."availableAt"')} as "availableAtUs",
  ${us('ready."updatedAt"')} as "updatedAtUs",ready."dispatchToken",ready."claimAttempt",
  ${us('ready."publishedAt"')} as "publishedAtUs",
  ${us('ready."recheckRequestedAt"')} as "recheckRequestedAtUs"`;

// Page the authoritative ready identities BEFORE filtering fresh metadata. This
// advances past retries/missing rows and cannot stick on an ineligible prefix.
export const historyArchiveRamSnapshotPageSql = `
with page as materialized (
  select * from history_archive_object_ready
  where ($1::uuid is null or "objectRemoteId">$1::uuid)
  order by "objectRemoteId" limit $2::integer
)
select ${candidateFields} from page ready ${metadata}
order by ready."objectRemoteId"`;

export const historyArchiveRamRefreshIdsSql = `
select ${candidateFields}
from unnest($1::uuid[]) requested(id)
join history_archive_object_ready ready on ready."objectRemoteId"=requested.id
${metadata}
order by ready."objectRemoteId"`;

/** All context reads are small controls or exact active object identities, never
 * evidence/XDR or historical queue scans. Root collation ranks use RAM's keys. */
export const historyArchiveRamContextSql = `
with canonical as (${historyArchiveCanonicalFirstScopeSelectSql('$1::text')}),
published as materialized (
  select ready."archiveUrlIdentity",object."objectType",object."hostIdentity"
  from history_archive_object_ready ready
  left join history_archive_broker_candidate candidate on candidate."remoteId"=ready."objectRemoteId"
  left join lateral (
    select object."objectType",object."hostIdentity" from history_archive_object_queue object
    where candidate."remoteId" is null and object."remoteId"=ready."objectRemoteId" limit 1
  ) fallback on true
  cross join lateral (select coalesce(candidate."objectType",fallback."objectType") as "objectType",
    coalesce(candidate."hostIdentity",fallback."hostIdentity") as "hostIdentity") object
  where ready."publishedAt" is not null
), scanning as materialized (
  select object."archiveUrlIdentity",object."objectType",object."hostIdentity"
  from history_archive_object_claim_slot slot
  cross join lateral (
    select object."archiveUrlIdentity",object."objectType",object."hostIdentity",object.status
    from history_archive_object_queue object where object."remoteId"=slot."objectRemoteId" limit 1
  ) object where object.status='scanning'
), roots as (select distinct root from unnest($2::text[]) root)
select ${us('now()')} as "databaseNowUs",(select incomplete from canonical) as "canonicalIncomplete",
coalesce((select jsonb_agg(row) from (
  select "archiveUrlIdentity",scope,${us('"blockedUntil"')} as "blockedUntilUs",
    ${us('"probeLeaseUntil"')} as "probeLeaseUntilUs",
    coalesce(jsonb_array_length("adaptiveProbeState"->'unknown'),0) as "unknownCount",
    "nextProbeCheckpoint"::integer as "nextProbeCheckpoint"
  from history_archive_root_failure_control
) row),'[]') as controls,
coalesce((select jsonb_agg(row) from (
  select "hostIdentity",${us('"blockedUntil"')} as "blockedUntilUs"
  from history_archive_object_host_throttle
) row),'[]') as "hostThrottles",
coalesce((select jsonb_agg(row) from (
  select "hostIdentity",count(*)::integer as "activeCount" from published
  where "hostIdentity" is not null group by "hostIdentity"
) row),'[]') as "activeHosts",
coalesce((select jsonb_agg(row) from (
  select "archiveUrlIdentity","objectType",sum(published)::integer as published,sum(scanning)::integer as scanning
  from (select "archiveUrlIdentity","objectType",1 as published,0 as scanning from published
    union all select "archiveUrlIdentity","objectType",0,1 from scanning) active
  group by "archiveUrlIdentity","objectType"
) row),'[]') as "activeScopes",
coalesce((select jsonb_agg(row) from (
  select root as "archiveUrlIdentity",(row_number() over(order by root))::integer as "sortRank" from roots
) row),'[]') as "rootSortRanks"`;
