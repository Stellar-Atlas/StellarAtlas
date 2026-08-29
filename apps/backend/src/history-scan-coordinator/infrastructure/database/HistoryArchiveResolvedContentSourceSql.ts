export function resolvedContentSourceSql(
	parameter: number,
	objectType: 'ledger' | 'transactions' | 'results'
): string {
	return `coalesce((
		select artifact."sourceObjectRemoteId"::text
		from "history_archive_content_observation" content_observation
		join "history_archive_content_artifact" artifact
			on artifact.id = content_observation."artifactId"
		join "history_archive_object_queue" source_object
			on source_object."remoteId" = content_observation."objectRemoteId"
			and source_object.status = 'verified'
			and source_object.attempts = content_observation."claimAttempt"
		where content_observation."objectRemoteId" = $${parameter}::uuid
			and source_object."objectType" = '${objectType}'
			and artifact."objectType" = source_object."objectType"
			and artifact."objectKey" = source_object."objectKey"
			and artifact."checkpointLedger" is not distinct from
				source_object."checkpointLedger"
		order by content_observation."claimAttempt" desc
		limit 1
	), $${parameter}::text)`;
}
