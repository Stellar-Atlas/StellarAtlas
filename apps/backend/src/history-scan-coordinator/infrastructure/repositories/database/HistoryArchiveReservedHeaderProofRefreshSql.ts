import { historyArchiveProofCompletionReserveMemberSql } from './HistoryArchiveProofCompletionReserveSql.js';

/** Locked RAM objects and controls precede durable intent, then Ready reservation. */
export const historyArchiveReservedHeaderProofRefreshSql = `header_proof_refresh_targets as materialized (
	select object."archiveUrlIdentity",object."checkpointLedger",
		object."updatedAt" as evidence_updated_at
	from ram_objects locked
	join history_archive_object_queue object on object."remoteId"=locked."remoteId"
	cross join (select count(*) as completed from ram_root_controls) ordered_controls
	where ordered_controls.completed>=0 and object.status='pending'
		and ${historyArchiveProofCompletionReserveMemberSql('object')}
		and not exists (
			select 1 from history_archive_checkpoint_proof_refresh_queue active
			where active."archiveUrlIdentity"=object."archiveUrlIdentity"
				and active."checkpointLedger"=object."checkpointLedger"
				and active."leaseUntil">now()
		)
), header_proof_refreshes_seeded as (
	insert into history_archive_checkpoint_proof_refresh_queue (
		"archiveUrlIdentity","checkpointLedger","evidenceUpdatedAt",generation,
		"requestedAt","nextAttemptAt","updatedAt","refreshKind"
	)
	select "archiveUrlIdentity","checkpointLedger",evidence_updated_at,1,
		now(),now(),now(),'header-proof-repair'
	from header_proof_refresh_targets
	where not exists (
		select 1 from history_archive_checkpoint_proof_refresh_queue existing
		where existing."archiveUrlIdentity"=header_proof_refresh_targets."archiveUrlIdentity"
			and existing."checkpointLedger"=header_proof_refresh_targets."checkpointLedger"
			and existing."refreshKind"='header-proof-repair'
	)
	order by "archiveUrlIdentity","checkpointLedger"
	on conflict ("archiveUrlIdentity","checkpointLedger") do update
	set "refreshKind"=excluded."refreshKind"
	where (history_archive_checkpoint_proof_refresh_queue."leaseUntil" is null
		or history_archive_checkpoint_proof_refresh_queue."leaseUntil"<=now())
		and history_archive_checkpoint_proof_refresh_queue."refreshKind"
			is distinct from excluded."refreshKind"
	returning "archiveUrlIdentity","checkpointLedger"
), header_proof_refresh_existing as materialized (
	select queue."archiveUrlIdentity",queue."checkpointLedger"
	from header_proof_refresh_targets target
	join history_archive_checkpoint_proof_refresh_queue queue
		on queue."archiveUrlIdentity"=target."archiveUrlIdentity"
		and queue."checkpointLedger"=target."checkpointLedger"
	where queue."refreshKind"='header-proof-repair'
		and (queue."leaseUntil" is null or queue."leaseUntil"<=now())
	order by queue."archiveUrlIdentity",queue."checkpointLedger"
	for update of queue skip locked
), header_proof_refresh_keys as materialized (
	select * from header_proof_refreshes_seeded
	union
	select * from header_proof_refresh_existing
)`;
