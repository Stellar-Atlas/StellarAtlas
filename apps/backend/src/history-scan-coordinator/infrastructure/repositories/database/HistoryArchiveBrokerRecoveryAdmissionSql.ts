import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

/** A necessary subset only. Final eligibility, manual intent, source recovery,
 * controls, host capacity, and reservation fences remain in the normal selector. */
export const historyArchiveBrokerRecoveryCandidatesSql = `recovery_candidates as materialized (
	select object."remoteId",object."archiveUrlIdentity",object."objectType",
		object."checkpointLedger",object.attempts
	from history_archive_broker_candidate object
	join history_archive_object_ready ready on ready."objectRemoteId"=object."remoteId"
	where object.status in ('pending','failed')
		and not (object.status='pending' and object.attempts=0)
		and ready."publishedAt" is null and ready."availableAt"<=now()
		and ready.priority<=$3::smallint
)`;

export const historyArchiveBrokerRecoveryAdmissionSql = `${historyArchiveBrokerRecoveryCandidatesSql},
recovery_identities as materialized (
	select ready."objectRemoteId" as "remoteId"
	from history_archive_object_ready ready
	where ready."recheckRequestedAt" is not null and ready."publishedAt" is null
	union
	select object."remoteId" from recovery_candidates object
	where object."objectType"='history-archive-state'
	union
	select object."remoteId" from history_archive_checkpoint_scan_cursor cursor
	join (select distinct "archiveUrlIdentity" from recovery_candidates
		where "objectType"='bucket' and attempts>0) attempted_roots
		on attempted_roots."archiveUrlIdentity"=cursor."archiveUrlIdentity"
	cross join lateral (
		${historyArchiveCheckpointBucketDependenciesSql('cursor."archiveUrlIdentity"', 'cursor."nextHistoricalCheckpointLedger"-64')}
	) dependency
	join history_archive_object_queue bucket
		on bucket."archiveUrlIdentity"=cursor."archiveUrlIdentity"
		and bucket."objectType"='bucket' and bucket."objectKey"='bucket:'||dependency."bucketHash"
	join recovery_candidates object on object."remoteId"=bucket."remoteId"
	where cursor."nextHistoricalCheckpointLedger">=127 and object.attempts>0
	union
	select object."remoteId" from history_archive_checkpoint_scan_cursor cursor
	join recovery_candidates object
		on object."archiveUrlIdentity"=cursor."archiveUrlIdentity"
		and object."objectType" in ('checkpoint-state','ledger','transactions','results','scp')
		and object."checkpointLedger"=cursor."nextHistoricalCheckpointLedger"-64
	where cursor."nextHistoricalCheckpointLedger">=127 and object.attempts>0
)`;

export const historyArchiveBrokerRecoveryCandidateIndexName =
	'history_archive_candidate_nonfresh_recovery';

export function createHistoryArchiveBrokerRecoveryCandidateIndex(
	tablespace: string
): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(tablespace))
		throw new Error('Invalid broker recovery index tablespace');
	return `create index concurrently if not exists ${historyArchiveBrokerRecoveryCandidateIndexName}
		on history_archive_broker_candidate ("objectType","archiveUrlIdentity","checkpointLedger","remoteId")
		include (attempts) tablespace "${tablespace}"
		where status in ('pending','failed') and not (status='pending' and attempts=0)`;
}
