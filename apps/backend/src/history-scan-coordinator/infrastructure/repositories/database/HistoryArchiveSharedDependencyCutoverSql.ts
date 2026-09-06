import { canonicalCheckpointHasStrictEvidenceSql } from './HistoryArchiveCanonicalCheckpointProofSql.js';

/**
 * The frontier's materialized hashes describe this source's verified JSON.
 * Skip legacy writes only when its exact observation and complete shared set
 * agree. Other sources' observations and incomplete/stale artifacts cannot gate it.
 */
export function canonicalCheckpointHasSharedDependenciesSql(): string {
	return `exists (
		select 1
		from history_archive_checkpoint_content_observation observation
		join history_archive_checkpoint_content content
			on content."contentDigest" = observation."contentDigest"
		join history_archive_checkpoint_bucket_set bucket_set
			on bucket_set."bucketSetDigest" = content."bucketSetDigest"
		cross join lateral (
			select count(*)::integer as count,
				encode(sha256(convert_to(
					string_agg(expected."bucketHash", ',' order by expected."bucketHash"),
					'UTF8'
				)), 'hex') as digest
			from hashes expected
			where expected."archiveUrlIdentity" = checkpoint."archiveUrlIdentity"
				and expected."checkpointLedger" = checkpoint."checkpointLedger"
		) expected
		where observation."archiveUrlIdentity" = checkpoint."archiveUrlIdentity"
			and observation."checkpointLedger" = checkpoint."checkpointLedger"
			and observation."checkpointStateObjectRemoteId" = checkpoint."remoteId"
			and content."checkpointLedger" = checkpoint."checkpointLedger"
			and content."contentDigest" =
				lower(checkpoint."verificationFacts"#>>'{content,digest}')
			and content."bucketListHash" =
				checkpoint."verificationFacts"#>>'{checkpointHistoryArchiveStateFact,bucketListHash}'
			and content."bucketSetDigest" = expected.digest
			and bucket_set."bucketCount" = expected.count
			and (
				select count(*) = bucket_set."bucketCount"
					and encode(sha256(convert_to(
						string_agg(member."bucketHash", ',' order by member."bucketHash"),
						'UTF8'
					)), 'hex') = expected.digest
				from history_archive_checkpoint_bucket_set_member member
				where member."bucketSetDigest" = bucket_set."bucketSetDigest"
			)
			and ${canonicalCheckpointHasStrictEvidenceSql('checkpoint')}
	)`;
}
