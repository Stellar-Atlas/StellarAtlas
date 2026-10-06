import type { EntityManager } from 'typeorm';

// A rebuildable scheduling projection, not another evidence/attempt store.
const columns = [
	'remoteId',
	'archiveUrlIdentity',
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
	'nextAttemptAt',
	'httpStatus',
	'errorType',
	'errorMessage'
] as const;
const names = columns.map((column) => `"${column}"`).join(', ');
const values = (alias: string): string =>
	columns.map((column) => `${alias}."${column}"`).join(', ');
const assignments = (alias: string): string =>
	columns
		.slice(1)
		.map((column) => `"${column}" = ${alias}."${column}"`)
		.join(', ');

export function createHistoryArchiveBrokerCandidateProjectionSchemaSql(
	tablespace?: string
): string {
	if (tablespace !== undefined && !/^[a-z_][a-z0-9_]*$/i.test(tablespace)) {
		throw new Error('Invalid broker candidate tablespace');
	}
	const tableSpaceSql =
		tablespace === undefined ? '' : ` tablespace "${tablespace}"`;
	const indexSpaceSql =
		tablespace === undefined ? '' : ` using index tablespace "${tablespace}"`;
	return `
create table if not exists history_archive_broker_candidate (
  "remoteId" uuid primary key${indexSpaceSql}, "archiveUrlIdentity" text not null,
  "hostIdentity" text not null, "objectType" text not null,
  "checkpointLedger" integer, "objectOrder" integer not null,
  status text not null, attempts integer not null,
  "executionDisposition" text not null, "dependencyReady" boolean not null,
  "transitionEffectsRequiredAt" timestamptz, "transitionEffectsCompletedAt" timestamptz,
  "nextAttemptAt" timestamptz, "httpStatus" integer, "errorType" text, "errorMessage" text
)${tableSpaceSql};
create or replace function history_archive_refresh_broker_candidates()
returns trigger language plpgsql as $$
begin
  -- Queue -> existing projection only; never lock/read/write ready here. Do not
  -- insert projections for historical queue rows that were never admitted.
  update history_archive_broker_candidate candidate set ${assignments('incoming')}
  from updated_objects incoming
  where candidate."remoteId"=incoming."remoteId"
    and row(${values('candidate')}) is distinct from row(${values('incoming')});
  return null;
end $$;
create trigger history_archive_broker_candidate_refresh
after update on history_archive_object_queue referencing new table as updated_objects
for each statement execute function history_archive_refresh_broker_candidates();
`;
}

export const historyArchiveBrokerCandidateProjectionSchemaSql =
	createHistoryArchiveBrokerCandidateProjectionSchemaSql();

/** Enumerate missing identities from the small NVMe ready/projection relations.
 * Probe at most512 queue PKs, never wait for a queue writer, and advance the
 * cursor even past busy rows. Wrap at the end; a fixed busy prefix cannot starve
 * later roots. Absent metadata cannot authorize work: reservation inner-joins it.
 * Queue SHARE -> projection is the same order as queue writers, with NO ready
 * row locks. The SHARE lock prevents overwriting a newer queue-trigger value. */
export const hydrateHistoryArchiveBrokerCandidatesSql = `
with missing as materialized (
  select ready."objectRemoteId" from history_archive_object_ready ready
  where ($1::uuid is null or ready."objectRemoteId">$1::uuid)
    and not exists (select 1 from history_archive_broker_candidate candidate
      where candidate."remoteId"=ready."objectRemoteId")
  order by ready."objectRemoteId" limit least(greatest($2::integer,1),512)
), objects as materialized (
  select ${values('object')} from missing
  join history_archive_object_queue object on object."remoteId"=missing."objectRemoteId"
  order by object."remoteId" for share of object skip locked
), hydrated as (
  insert into history_archive_broker_candidate as stored (${names})
  select ${names} from objects
  on conflict ("remoteId") do update set ${assignments('excluded')}
    where row(${values('stored')}) is distinct from row(${values('excluded')})
  returning "remoteId"
)
select (select count(*)::integer from hydrated) as hydrated,
  (select "objectRemoteId" from missing order by "objectRemoteId" desc limit 1) as cursor
`;

// Cleanup never locks ready or waits on projection rows held by queue writers.
// A concurrent delete/reinsert may temporarily lose this rebuildable metadata;
// the missing-identity hydrator restores it without changing source evidence.
export const cleanupHistoryArchiveBrokerCandidatesSql = `
with locked as materialized (
  select candidate."remoteId" from history_archive_broker_candidate candidate
  where not exists (select 1 from history_archive_object_ready ready
    where ready."objectRemoteId"=candidate."remoteId")
  order by candidate."remoteId" limit 512 for update of candidate skip locked
)
delete from history_archive_broker_candidate candidate using locked
where candidate."remoteId"=locked."remoteId"
`;

export class HistoryArchiveBrokerCandidateProjection {
	private cursor: string | null = null;
	async cleanup(manager: EntityManager): Promise<void> {
		await manager.query(cleanupHistoryArchiveBrokerCandidatesSql);
	}
	async hydrate(manager: EntityManager, limit: number): Promise<void> {
		const [result] = (await manager.query(
			hydrateHistoryArchiveBrokerCandidatesSql,
			[this.cursor, Math.min(Math.max(1, Math.floor(limit)), 128)]
		)) as { cursor: string | null }[];
		this.cursor = result?.cursor ?? null;
	}
}

export const dropHistoryArchiveBrokerCandidateProjectionSql = `
drop trigger if exists history_archive_broker_candidate_refresh on history_archive_object_queue;
drop function if exists history_archive_refresh_broker_candidates();
drop table if exists history_archive_broker_candidate;
`;
