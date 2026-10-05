import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

/** Recover a lost late-completion wake, never a missing or invalid bucket.
 * The caller restricts this to the one open checkpoint and normal proof
 * readiness; this predicate only admits newer, fully matched source evidence.
 */
export function historyArchiveStaleBucketProofRecoverySql(
	proofAlias: string
): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(proofAlias))
		throw new Error('Invalid stale bucket proof SQL alias');
	return `(${proofAlias}.status = 'not-evaluable'
		and ${proofAlias}."failureKind" = 'bucket-missing'
		and ${proofAlias}."expectedBucketCount" > 0
		and exists (
			select 1 from lateral (
				${historyArchiveCheckpointBucketDependenciesSql(
					proofAlias + '."archiveUrlIdentity"',
					proofAlias + '."checkpointLedger"'
				)}
			) dependency
			left join lateral (
				select bucket.status, bucket."verifiedAt", bucket."objectUrl",
					bucket."verificationFacts", bucket."transitionEffectsRequiredAt",
					bucket."transitionEffectsCompletedAt"
				from history_archive_object_queue bucket
				where bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
					and bucket."objectType" = 'bucket'
					and bucket."objectKey" = 'bucket:' || dependency."bucketHash"
					and bucket."bucketHash" = dependency."bucketHash"
				limit 1
			) bucket on true
			having count(distinct dependency."bucketHash") = ${proofAlias}."expectedBucketCount"
				and bool_and(coalesce(
					bucket.status = 'verified'
					and bucket."verificationFacts"#>>'{bucketObject,matched}' = 'true'
					and lower(bucket."verificationFacts"#>>'{bucketObject,expectedBucketHash}') = dependency."bucketHash"
					and bucket."verificationFacts"#>>'{bucketObject,sourceUrl}' = bucket."objectUrl"
					and (bucket."transitionEffectsRequiredAt" is null
						or bucket."transitionEffectsCompletedAt" is not null), false))
				and max(bucket."verifiedAt") > ${proofAlias}."evaluatedAt"
		))`;
}
