export const historyArchiveCheckpointProofFailureCtesSql = `
	failed_objects as (
		select target."archiveUrlIdentity", target."checkpointLedger",
			object."remoteId" as remote_id, object."objectType" as object_type,
			object."objectKey" as object_key, object."errorType" as error_type,
			object."errorMessage" as error_message,
			object."failureChannel" as failure_channel,
			object."httpStatus" as http_status
		from target_checkpoints target
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = target."archiveUrlIdentity"
			and object."checkpointLedger" = target."checkpointLedger"
		where object.status = 'failed'
			and object."objectType" <> 'scp'
		union all
		select expected."archiveUrlIdentity", expected."checkpointLedger",
			bucket."remoteId", bucket."objectType", bucket."objectKey",
			bucket."errorType", bucket."errorMessage", bucket."failureChannel",
			bucket."httpStatus"
		from expected_bucket_hashes expected
		join "history_archive_object_queue" bucket
			on bucket."archiveUrlIdentity" = expected."archiveUrlIdentity"
			and bucket."objectType" = 'bucket'
			and bucket."bucketHash" = expected."bucketHash"
		where bucket.status = 'failed'
	), failure_rollup as (
		select "archiveUrlIdentity", "checkpointLedger",
			case
				when count(*) = 1
					then min(error_type)
				else null
			end as failure_error_type,
			case
				when count(*) = 1
					then min(http_status)
				else null
			end as failure_http_status,
			case
				when count(distinct coalesce(failure_channel, 'unclassified')) = 1
					then min(failure_channel)
				else null
			end as failure_channel,
			array_remove(array[
				case when bool_or(failure_channel = 'archive_evidence')
					then 'archive_evidence'::text end,
				case when bool_or(failure_channel = 'scanner_issue')
					then 'scanner_issue'::text end,
				case when bool_or(failure_channel is null)
					then 'unclassified'::text end
			], null) as failure_channels,
			jsonb_agg(jsonb_build_object(
				'remoteId', remote_id, 'objectType', object_type,
				'objectKey', object_key, 'errorType', error_type,
				'errorMessage', error_message,
				'failureChannel', failure_channel, 'httpStatus', http_status
			) order by object_type, object_key, remote_id) as object_failures
		from failed_objects
		group by "archiveUrlIdentity", "checkpointLedger"
	)
`;
