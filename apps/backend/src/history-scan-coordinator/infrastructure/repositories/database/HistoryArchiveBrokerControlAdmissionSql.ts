import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';

/** Evaluate root/category-invariant controls before walking a fresh index range.
 * Use the authoritative predicate unchanged, including active publications and
 * claim slots. An adaptive scope is represented by one required point: any
 * conflicting wildcard/category point (including NULL) then rejects the scope.
 * NULL remains a valid adaptive target and uses the existing NULL admission arm.
 * Per-object eligibility and final control locking still run as backstops. */
export const historyArchiveBrokerControlAdmissionSql = `fresh_control_scopes as materialized (
	select scope.*,probe."checkpointLedger",coalesce(probe.point_only,false) as point_only
	from ready_scopes scope
	left join lateral (
		select control."nextProbeCheckpoint" as "checkpointLedger",true as point_only
		from history_archive_root_failure_control control
		where control."archiveUrlIdentity"=scope."archiveUrlIdentity"
			and control.scope in ('*',scope."objectType")
			and coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0
		order by control.scope limit 1
	) probe on true
), fresh_admissible_scopes as materialized (
	select scope."archiveUrlIdentity",scope.priority,scope."objectType",
		case when scope.point_only then scope."checkpointLedger" else scope.first_checkpoint end as first_checkpoint,
		case when scope.point_only then scope."checkpointLedger" else scope.last_checkpoint end as last_checkpoint,
		scope.has_null_checkpoint and (not scope.point_only or scope."checkpointLedger" is null) as has_null_checkpoint
	from fresh_control_scopes scope
	where ${historyArchiveRootControlAllowedSql('scope')}
)`;
