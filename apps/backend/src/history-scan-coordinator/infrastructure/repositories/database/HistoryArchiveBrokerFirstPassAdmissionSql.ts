import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

/** Bound global ranking without dropping a sparse root behind another root's
 * backlog. Each root/priority/category contributes at most twice the host/batch
 * cap (disjoint null/non-null branches); final host limits remain unchanged.
 * The lane's oldest eligible ready timestamp is found independently, so an old
 * timestamp outside the checkpoint prefix still controls round-robin fairness. */
export function historyArchiveBrokerFirstPassAdmissionSql(
	eligibleSql: string
): string {
	const fresh = `object.status='pending' and object.attempts=0`;
	const scope = `object."archiveUrlIdentity"=scope."archiveUrlIdentity"
		and ready.priority=scope.priority and ${fresh}`;
	const freshCategory = (checkpoint: string): string => `(
		${eligibleSql} and ${scope} and object."objectType"=scope."objectType"
			and ${checkpoint}
		order by object."checkpointLedger" asc nulls first,object."objectOrder",
			ready."updatedAt",ready."objectRemoteId"
		limit least($1::integer,$2::integer)
	)`;
	return `ready_scopes as materialized (
		select ready."archiveUrlIdentity",ready.priority,fresh."objectType",
			min(fresh."checkpointLedger") as first_checkpoint,
			max(fresh."checkpointLedger") as last_checkpoint,
			bool_or(fresh."checkpointLedger" is null) as has_null_checkpoint
		from history_archive_object_ready ready
		join history_archive_broker_candidate fresh on fresh."remoteId"=ready."objectRemoteId"
		where ready."publishedAt" is null and ready."availableAt"<=now()
			and ready.priority<=$3::smallint
			and fresh.status='pending' and fresh.attempts=0
		group by ready."archiveUrlIdentity",ready.priority,fresh."objectType"
	), fresh_age_scopes as materialized (
		select scope."archiveUrlIdentity",scope.priority,
			bool_or(not exists (
				select 1 from history_archive_root_failure_control control
				where control."archiveUrlIdentity"=scope."archiveUrlIdentity"
					and control.scope in ('*',scope."objectType")
					and (control."blockedUntil" is not null
						or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
			)) as has_uncontrolled_scope
		from ready_scopes scope
		group by scope."archiveUrlIdentity",scope.priority
	), fresh_root_minimum as materialized (
		select scope.*,oldest."updatedAt" as first_pass_root_ready_at
		from fresh_age_scopes scope
		left join lateral (
			select lane."updatedAt" from history_archive_object_ready lane
			cross join lateral (
				${eligibleSql} and ${scope} and control.scope is null
					and ready."objectRemoteId"=lane."objectRemoteId" limit 1
			) eligible_oldest
			-- Controlled admissions never consume this age. Avoid walking their
			-- entire ready prefix looking for a categorically impossible NULL control.
			where scope.has_uncontrolled_scope
				and lane."archiveUrlIdentity"=scope."archiveUrlIdentity"
				and lane.priority=scope.priority and lane."publishedAt" is null
			order by lane."updatedAt",lane."objectRemoteId" limit 1
		) oldest on true
	), fresh_admission as materialized (
		select admitted.*,case when admitted.control_scope is null
			then oldest.first_pass_root_ready_at else null::timestamptz end as first_pass_root_ready_at
		from ready_scopes scope
		join fresh_root_minimum oldest using ("archiveUrlIdentity",priority)
		cross join lateral (
			${freshCategory('object."checkpointLedger" between scope.first_checkpoint and scope.last_checkpoint')}
			union all
			${freshCategory('scope.has_null_checkpoint and object."checkpointLedger" is null')}
		) admitted
	), recovery_identities as materialized (
		select ready."objectRemoteId" as "remoteId"
		from history_archive_object_ready ready
		where ready."recheckRequestedAt" is not null and ready."publishedAt" is null
		union
		select object."remoteId" from history_archive_broker_candidate object
		where object.status in ('pending','failed')
			and object."objectType"='history-archive-state'
		union
		select object."remoteId" from history_archive_checkpoint_scan_cursor cursor
		cross join lateral (
			${historyArchiveCheckpointBucketDependenciesSql('cursor."archiveUrlIdentity"', 'cursor."nextHistoricalCheckpointLedger"-64')}
		) dependency
		join history_archive_object_queue bucket
			on bucket."archiveUrlIdentity"=cursor."archiveUrlIdentity"
			and bucket."objectType"='bucket' and bucket."objectKey"='bucket:'||dependency."bucketHash"
		join history_archive_broker_candidate object on object."remoteId"=bucket."remoteId"
		where cursor."nextHistoricalCheckpointLedger">=127
			and object.attempts>0 and object.status in ('pending','failed')
		union
		select object."remoteId" from history_archive_checkpoint_scan_cursor cursor
		cross join (values ('checkpoint-state'),('ledger'),('transactions'),('results'),('scp')) category("objectType")
		join history_archive_broker_candidate object
			on object."archiveUrlIdentity"=cursor."archiveUrlIdentity"
			and object."objectType"=category."objectType"
			and object."checkpointLedger"=cursor."nextHistoricalCheckpointLedger"-64
		where cursor."nextHistoricalCheckpointLedger">=127
			and object.attempts>0 and object.status in ('pending','failed')
	), eligible as materialized (
		select * from fresh_admission
		union all
		select admitted.*,null::timestamptz as first_pass_root_ready_at
		from recovery_identities recovery
		cross join lateral (
			${eligibleSql} and object."remoteId"=recovery."remoteId" and not (${fresh})
			limit 1
		) admitted
	)`;
}

// Scheduling-only indexes: no proof/evidence rewrite. The migration is deliberately
// nontransactional so operators can install these concurrently on live NVMe tables.
export const historyArchiveBrokerFirstPassIndexes = [
	`create index concurrently if not exists history_archive_candidate_fresh_order
	 on history_archive_broker_candidate ("archiveUrlIdentity","objectType","checkpointLedger" asc nulls first,"objectOrder","remoteId")
	 where status='pending' and attempts=0`,
	`create index concurrently if not exists history_archive_candidate_recovery_scope
	 on history_archive_broker_candidate ("objectType","archiveUrlIdentity","checkpointLedger","remoteId")
	 where status in ('pending','failed')`,
	`create index concurrently if not exists history_archive_ready_root_oldest
	 on history_archive_object_ready ("archiveUrlIdentity",priority,"updatedAt","objectRemoteId")
	 where "publishedAt" is null`,
	`create index concurrently if not exists history_archive_ready_manual_recheck
	 on history_archive_object_ready ("objectRemoteId")
	 where "recheckRequestedAt" is not null and "publishedAt" is null`
] as const;

export function createHistoryArchiveBrokerFirstPassIndexes(
	tablespace?: string
): string[] {
	if (tablespace !== undefined && !/^[a-z_][a-z0-9_]*$/i.test(tablespace)) {
		throw new Error('Invalid broker first-pass tablespace');
	}
	return historyArchiveBrokerFirstPassIndexes.map((sql) =>
		tablespace === undefined
			? sql
			: sql.replace('\n\t where ', `\n\t tablespace "${tablespace}" where `)
	);
}
