import type { HistoryArchiveCheckpointProofRefreshTarget } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';

export function toHistoryArchiveCheckpointProofRefreshParams(
	target: HistoryArchiveCheckpointProofRefreshTarget
): readonly [string, number | null, string | null] {
	return [
		target.archiveUrlIdentity,
		target.checkpointLedger ?? null,
		target.bucketHash ?? null
	];
}

export const archiveObjectFilterSql =
	'"archiveUrlIdentity" = $1::text and "checkpointLedger" is not null';

export const ledgerFactsJsonSql = `
	coalesce("verificationFacts"->'ledgerCategory'->'ledgers', '[]'::jsonb)
`;

export const transactionsFactsJsonSql = `
	coalesce("verificationFacts"->'transactionsCategory'->'ledgers', '[]'::jsonb)
`;

export const resultsFactsJsonSql = `
	coalesce("verificationFacts"->'resultsCategory'->'ledgers', '[]'::jsonb)
`;

export const expectedBucketHashesSql = `
	expected_bucket_hashes as (
		select distinct
			object."archiveUrl",
			object."archiveUrlIdentity",
			object."checkpointLedger",
			lower(hash.value) as "bucketHash"
		from checkpoint_state_objects object
		cross join lateral jsonb_array_elements(
			coalesce(
				object."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'currentBuckets',
				'[]'::jsonb
			)
			|| coalesce(
				object."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'hotArchiveBuckets',
				'[]'::jsonb
			)
		) bucket
		cross join lateral (
			values
				(bucket->>'curr'),
				(bucket->>'snap'),
				(bucket->'next'->>'output')
		) hash(value)
		where hash.value is not null
			and lower(hash.value) ~ '^[0-9a-f]{64}$'
			and lower(hash.value) !~ '^0+$'
	)
`;
