import { historyArchiveCanonicalFirstScopeCteSql } from './HistoryArchiveCanonicalFirst.js';
import { historyArchiveBrokerFreshEligibilitySql } from './HistoryArchiveBrokerFreshEligibilitySql.js';
import { historyArchiveBrokerReservationTailSql } from './HistoryArchiveBrokerReservationTailSql.js';

export interface HistoryArchiveBrokerCandidateId {
	readonly remoteId: string;
	readonly selectedOrdinal: number;
	/** Exact oldest eligible uncontrolled root/priority age, with PostgreSQL microseconds. */
	readonly firstPassRootReadyAt: string | null;
}

const candidateLocks = `lockable as materialized (
	select ready."objectRemoteId" from ram_ready ready
	join selected using ("objectRemoteId")
), retry_object_lockable as materialized (
	select "remoteId" from ram_objects where false
), root_control_lockable as materialized (
	select control.* from ram_root_controls control
	where exists (select 1 from selected join lockable using ("objectRemoteId")
		where selected."archiveUrlIdentity"=control."archiveUrlIdentity"
			and control.scope in ('*',selected."objectType"))
)`;

// RAM already ranked the complete snapshot. Re-ranking its selected subset can
// lose unselected root-age contributors and reverse fairness. Current database
// controls/caps may remove identities, but never invent a new relative order.
const candidateSelection = `root_probe_ranked as materialized (
	select eligible.*,row_number() over (
		partition by "archiveUrlIdentity",control_scope
		order by "selectedOrdinal","objectRemoteId"
	) as probe_rank from eligible
), ranked as materialized (
	select candidate.*,row_number() over (
		partition by "hostIdentity" order by "selectedOrdinal","objectRemoteId"
	) as host_rank from root_probe_ranked candidate
	where control_scope is null or probe_rank=1
), selected as materialized (
	select "objectRemoteId",priority,is_transient_source_retry,stored_priority,
		"checkpointLedger","objectOrder","objectType",control_scope,
		"archiveUrlIdentity","selectedOrdinal"
	from ranked where active_count+host_rank<=$2::integer
	order by "selectedOrdinal","objectRemoteId" limit $1::integer
)`;

/** First-pass only. $1..$4 retain the existing reservation contract; $5 contains
 * at most $1 RAM-selected identities. The caller must hold the dispatcher lock.
 * Ready -> exact durable objects -> root controls is the completion lock order.
 * Locked row versions, not the rebuildable RAM/projection, authorize execution. */
export function buildReserveBrokerCandidateIdsSql(): string {
	return `with ${historyArchiveCanonicalFirstScopeCteSql('$4::text')},
	ram_input as materialized (
		select distinct on (input."remoteId") input.* from (
			select * from jsonb_to_recordset($5::jsonb) as value(
				"remoteId" uuid,"selectedOrdinal" integer,"firstPassRootReadyAt" timestamptz)
			order by "selectedOrdinal","remoteId" limit greatest($1::integer,0)
		) input order by input."remoteId",input."selectedOrdinal"
	), ram_ready as materialized (
		select ready.* from ram_input input
		join history_archive_object_ready ready on ready."objectRemoteId"=input."remoteId"
		where ready."publishedAt" is null
		order by ready."objectRemoteId" for update of ready skip locked
	), ram_objects as materialized (
		select object."remoteId",object."archiveUrlIdentity",object."hostIdentity",
			object."objectType",object."checkpointLedger",object."objectOrder",
			object.status,object.attempts,object."executionDisposition",object."dependencyReady",
			object."transitionEffectsRequiredAt",object."transitionEffectsCompletedAt",
			object."nextAttemptAt",object."httpStatus",object."errorType",object."errorMessage",
			object."archiveUrl",object."objectKey",object."objectUrl",object."bucketHash"
		from ram_ready ready join history_archive_object_queue object
			on object."remoteId"=ready."objectRemoteId"
		where object.status='pending' and object.attempts=0
		order by object."archiveUrlIdentity",object."objectType",object."objectKey"
		for no key update of object skip locked
	), ram_root_controls as materialized (
		select control.* from history_archive_root_failure_control control
		cross join (select count(*) from ram_objects) ordered_objects
		where exists (select 1 from ram_objects object
			where object."archiveUrlIdentity"=control."archiveUrlIdentity"
				and control.scope in ('*',object."objectType"))
		order by control."archiveUrlIdentity",control.scope for update of control
	), active_hosts as materialized (
		select object."hostIdentity",count(*)::integer as active_count
		from history_archive_object_ready ready
		cross join lateral (
			select "hostIdentity" from history_archive_object_queue object
			where object."remoteId"=ready."objectRemoteId" limit 1
		) object where ready."publishedAt" is not null group by object."hostIdentity"
	), eligible as materialized (
		select source.*,input."selectedOrdinal",case when source.control_scope is null then input."firstPassRootReadyAt"
			else null::timestamptz end as first_pass_root_ready_at
		from (${historyArchiveBrokerFreshEligibilitySql({ ready: 'ram_ready', object: 'ram_objects', control: 'ram_root_controls' })}) source
		join ram_input input on input."remoteId"=source."objectRemoteId"
	), ${historyArchiveBrokerReservationTailSql(false, {
		selectionSql: candidateSelection,
		lockSql: candidateLocks,
		objectRelation: 'ram_objects',
		finalReadyGuard: `
			and ready."publishedAt" is null
			and exists (select 1 from ram_ready locked
				where locked."objectRemoteId"=ready."objectRemoteId"
					and locked."dispatchToken" is not distinct from ready."dispatchToken"
					and locked."claimAttempt" is not distinct from ready."claimAttempt")`
	})}`;
}
