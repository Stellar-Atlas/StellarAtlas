import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

// Continuation is not verification or a retry. Keep the failed source observation
// and use a separately verified same-network checkpoint as the next boundary.
export function remoteCheckpointFailureExistsSql(proofAlias: string): string {
	return `(
  exists (
   select 1 from "history_archive_object_queue" failed_object
   where failed_object."archiveUrlIdentity" = ${proofAlias}."archiveUrlIdentity"
    and failed_object."checkpointLedger" = ${proofAlias}."checkpointLedger"
    and failed_object."objectType" in ('checkpoint-state', 'ledger', 'transactions', 'results')
    and ${remoteFailureSql('failed_object')}
  )
  or exists (
   select 1 from lateral (
    ${historyArchiveCheckpointBucketDependenciesSql(
			proofAlias + '."archiveUrlIdentity"',
			proofAlias + '."checkpointLedger"'
		)}
   ) dependency
   join "history_archive_object_queue" failed_bucket
    on failed_bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
    and failed_bucket."objectType" = 'bucket'
    and failed_bucket."bucketHash" = dependency."bucketHash"
   where ${remoteFailureSql('failed_bucket')}
  )
 )`;
}

function remoteFailureSql(alias: string): string {
	return `${alias}.status = 'failed' and (
  ${alias}."failureChannel" in ('archive_evidence', 'archive_availability')
  or (${alias}."failureChannel" is null and ${alias}."httpStatus" in (403, 404, 410))
 )`;
}
