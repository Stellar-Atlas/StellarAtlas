import type { HistoryArchiveObjectFailure } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

export const historyArchiveRootFailureControlSchemaSql = `
create table if not exists history_archive_root_failure_control (
  "archiveUrlIdentity" text not null, scope text not null,
  "failureKind" text not null, "consecutiveFailures" integer not null default 0,
  "missingCheckpoints" bigint[] not null default '{}',
  "lastFailureAt" timestamptz, "lastSuccessAt" timestamptz,"lastAttemptStartedAt" timestamptz,
  "blockedUntil" timestamptz, "cooldownStep" integer not null default 0,
  "probeExecutionId" uuid, "probeLeaseUntil" timestamptz,
  "listingStatus" text, "listingCheckedAt" timestamptz,
  "adaptiveProbeState" jsonb, "nextProbeCheckpoint" bigint,
  "lastCheckpoint" bigint, "lastOutcome" text, version bigint not null default 0,
  "updatedAt" timestamptz not null default now(),
  primary key ("archiveUrlIdentity", scope),
  check (scope in ('*','history-archive-state','checkpoint-state','ledger','transactions','results','scp','bucket')),
  check ("listingStatus" is null or "listingStatus" in ('supported','unsupported','inconclusive'))
)`;

export interface RootFailureClassification {
	readonly kind: 'missing' | 'auth' | 'transient';
	readonly rootWide: boolean;
}

export function classifyRootFailure(
	failure: HistoryArchiveObjectFailure
): RootFailureClassification | null {
	if (failure.failureChannel === 'scanner_issue') return null;
	const status = failure.httpStatus;
	if (status === 404 || status === 410)
		return { kind: 'missing', rootWide: false };
	if (status === 401 || status === 403)
		return { kind: 'auth', rootWide: false };
	if (status === 429) return null; // Existing host-wide Retry-After policy owns 429.
	if (status === 408 || (status != null && status >= 500 && status <= 599))
		return { kind: 'transient', rootWide: false };
	if (status != null && status >= 300) return null;
	if (failure.failureChannel !== 'archive_availability') return null;
	const detail = `${failure.errorType} ${failure.errorMessage}`;
	if (
		/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|CERT_|TLS/i.test(
			detail
		)
	)
		return { kind: 'transient', rootWide: true };
	if (
		/ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|socket hang up|connection time.?out|timed? out|timeout/i.test(
			detail
		)
	)
		return { kind: 'transient', rootWide: false };
	return null; // Cancellation, local/setup errors and blank errors are not root evidence.
}

/** Read-only predicate; the broker also leases expired controls atomically. */
export function historyArchiveRootControlAllowedSql(
	alias: string,
	readyAlias?: string
): string {
	const ownExecution =
		readyAlias === undefined
			? 'false'
			: `control."probeExecutionId"=${readyAlias}."dispatchToken"`;
	const otherObject =
		readyAlias === undefined
			? 'true'
			: `active."objectRemoteId"<>${readyAlias}."objectRemoteId"`;
	return `not exists (select 1 from history_archive_root_failure_control control
    where control."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
      and control.scope in ('*', ${alias}."objectType")
      and (control."blockedUntil" > now() or (control."probeLeaseUntil" > now() and not coalesce(${ownExecution},false))
        or (coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0
          and ${alias}."checkpointLedger" is distinct from control."nextProbeCheckpoint")
        or ((control."blockedUntil" is not null or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
          and exists (select 1 from history_archive_object_ready active
            join lateral (select candidate."objectType" from history_archive_object_queue candidate
              where candidate."remoteId"=active."objectRemoteId" limit 1) active_object on true
            where active."archiveUrlIdentity"=control."archiveUrlIdentity" and active."publishedAt" is not null
              and ${otherObject} and (control.scope='*' or active_object."objectType"=control.scope)))
        or ((control."blockedUntil" is not null or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
          and exists (select 1 from history_archive_object_claim_slot active_slot
            join lateral (select candidate."archiveUrlIdentity",candidate."objectType",candidate.status
              from history_archive_object_queue candidate
              where candidate."remoteId"=active_slot."objectRemoteId" limit 1) active_object on true
            where active_object."archiveUrlIdentity"=control."archiveUrlIdentity" and active_object.status='scanning'
              and (control.scope='*' or active_object."objectType"=control.scope)))))`;
}

// This expression examines at most16 distinct observed positions, never queue history.
const positionsSql = `array(select distinct position from unnest(
  case when stored."failureKind"='missing' and stored."lastFailureAt">now()-interval '15 minutes'
    then stored."missingCheckpoints" else '{}'::bigint[] end || excluded."missingCheckpoints"
) position order by position desc limit 16)`;
const adjacentMissingSql = `exists (select 1 from unnest(${positionsSql}) position
  where position+64=any(${positionsSql}) and position+128=any(${positionsSql}))`;
const thresholdSql = `(case when excluded."failureKind"='missing' and excluded.scope<>'bucket' then ${adjacentMissingSql}
  else case when stored."failureKind"=excluded."failureKind" and stored."lastFailureAt">now()-interval '15 minutes'
    then stored."consecutiveFailures"+1 else 1 end >= 3 end)`;
const blockedUntilSql = `case when ${thresholdSql} then greatest(
  excluded."blockedUntil", case when stored."blockedUntil">now() then stored."blockedUntil"
    else now()+make_interval(secs => least(1800,30*power(2,least(stored."cooldownStep",6)))::integer) end)
  else excluded."blockedUntil" end`;

/** Append to the already-fenced terminal UPDATE: no extra per-object query. */
export function recordRootFailureSql(
	updateSql: string,
	payloadParameter: string
): string {
	return `with accepted as (${updateSql}), input as (
    select * from jsonb_to_record(${payloadParameter}::jsonb) as detail(
      kind text, "rootWide" boolean, "retryAfterSeconds" integer, "listingStatus" text)
  ), changed as (
    insert into history_archive_root_failure_control as stored (
      "archiveUrlIdentity",scope,"failureKind","consecutiveFailures","missingCheckpoints",
      "lastFailureAt","blockedUntil","listingStatus","listingCheckedAt","lastCheckpoint","lastOutcome","lastAttemptStartedAt",version
    ) select accepted."archiveUrlIdentity",case when input."rootWide" then '*' else accepted."objectType" end,
      input.kind,1,case when input.kind='missing' and accepted."checkpointLedger" is not null
        then array[accepted."checkpointLedger"::bigint] else '{}'::bigint[] end,
      now(),case when input."retryAfterSeconds">0 then now()+make_interval(secs=>input."retryAfterSeconds") end,
      null,null,
      accepted."checkpointLedger",input.kind,accepted."attemptStartedAt",1
    from accepted cross join input
    where input.kind is not null
    order by accepted."archiveUrlIdentity",accepted."objectType"
    on conflict ("archiveUrlIdentity",scope) do update set
      "failureKind"=excluded."failureKind",
      "consecutiveFailures"=case when stored."failureKind"=excluded."failureKind" and stored."lastFailureAt">now()-interval '15 minutes'
        then stored."consecutiveFailures"+1 else 1 end,
      "missingCheckpoints"=${positionsSql},
      "blockedUntil"=${blockedUntilSql},
      "cooldownStep"=case when ${thresholdSql} and (stored."blockedUntil" is null or stored."blockedUntil"<=now())
        then least(7,stored."cooldownStep"+1) else stored."cooldownStep" end,
      "lastFailureAt"=now(),
      "probeExecutionId"=case when stored."probeExecutionId"=(select "executionId" from accepted limit 1)
        then null else stored."probeExecutionId" end,
      "probeLeaseUntil"=case when stored."probeExecutionId"=(select "executionId" from accepted limit 1)
        then null else stored."probeLeaseUntil" end,
      "listingStatus"=case when stored."probeExecutionId"=(select "executionId" from accepted limit 1)
        then coalesce((select "listingStatus" from input),stored."listingStatus") else stored."listingStatus" end,
      "listingCheckedAt"=case when stored."probeExecutionId"=(select "executionId" from accepted limit 1)
        and (select "listingStatus" from input) is not null then now() else stored."listingCheckedAt" end,
      "lastCheckpoint"=excluded."lastCheckpoint","lastOutcome"=excluded."lastOutcome",
      "lastAttemptStartedAt"=excluded."lastAttemptStartedAt",
      version=stored.version+1,"updatedAt"=now()
    where stored."lastSuccessAt" is null or excluded."lastAttemptStartedAt" is null
      or excluded."lastAttemptStartedAt">=stored."lastSuccessAt"
    returning "archiveUrlIdentity"
  ) select accepted.* from accepted`;
}

/** Healthy batches touch only existing failure controls and aggregate by root/scope. */
export const clearRootFailureOnVerifiedCteSql = `root_successes as materialized (
  select control."archiveUrlIdentity",control.scope,max(updated."checkpointLedger") as checkpoint
  from updated join history_archive_root_failure_control control
    on control."archiveUrlIdentity"=updated."archiveUrlIdentity"
      and control.scope in ('*',updated."objectType")
      and (updated."executionId"=control."probeExecutionId"
        or updated."attemptStartedAt">=control."lastFailureAt")
  group by control."archiveUrlIdentity",control.scope
), root_success_lockable as materialized (
  select control."archiveUrlIdentity",control.scope from history_archive_root_failure_control control
  join root_successes success using ("archiveUrlIdentity",scope)
  order by control."archiveUrlIdentity",control.scope for update of control
), root_success_recorded as (
  update history_archive_root_failure_control control set
    "consecutiveFailures"=0,"missingCheckpoints"='{}',"blockedUntil"=null,"cooldownStep"=0,
    "probeExecutionId"=null,"probeLeaseUntil"=null,"lastSuccessAt"=now(),
    "lastCheckpoint"=success.checkpoint,"lastOutcome"='success',version=control.version+1,"updatedAt"=now()
  from root_successes success,root_success_lockable locked
  where control."archiveUrlIdentity"=success."archiveUrlIdentity" and control.scope=success.scope
    and locked."archiveUrlIdentity"=control."archiveUrlIdentity" and locked.scope=control.scope
  returning control."archiveUrlIdentity"
)`;
