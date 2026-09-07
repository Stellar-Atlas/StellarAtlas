import { historyArchiveSequentialPrefetchLedgerSpan } from './HistoryArchiveSequentialChainSql.js';
import { historyArchiveCheckpointBucketDependencyRangeSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export function historyArchiveReadyMutableEligibilitySql(
	alias: string
): string {
	return `
		${alias}."executionDisposition" = 'executable'
		and ${alias}."dependencyReady" = true
		and (
			${alias}."transitionEffectsRequiredAt" is null
			or ${alias}."transitionEffectsCompletedAt" is not null
		)
		and (
			${alias}.status = 'pending'
			or (
				${alias}.status = 'failed'
				and ${alias}."nextAttemptAt" is not null
				and ${alias}."nextAttemptAt" <= now()
			)
		)
	`;
}

const candidateColumns = `
	candidate."remoteId", candidate."executionReason", candidate.status,
	candidate."nextAttemptAt", candidate."updatedAt", candidate."lastClaimedAt",
	candidate."objectOrder", candidate."checkpointLedger", candidate."objectKey",
	candidate."objectType", candidate."bucketHash", candidate."archiveUrlIdentity",
	candidate.id
`;

// Enumerate the open cohort before ranking it. Each branch keeps the cheap
// eligibility predicate local, so partial indexes exclude non-runnable history.
// Null-checkpoint objects are independent of the cursor, including null buckets.
// OFFSET 0 keeps parameterized range/hash lookups from being pulled up into
// joins that scan a whole root before applying the cohort condition.
export function historyArchiveReadyCohortCandidatesSql(
	archiveUrlIdentitySql: string
): string {
	const eligible = historyArchiveReadyMutableEligibilitySql('candidate');
	return `
		with chain_cursor as materialized (
			select "nextHistoricalCheckpointLedger" - 64 as first_checkpoint,
				"nextHistoricalCheckpointLedger" - 64 +
					${historyArchiveSequentialPrefetchLedgerSpan} as last_checkpoint
			from "history_archive_checkpoint_scan_cursor"
			where "archiveUrlIdentity" = ${archiveUrlIdentitySql}
				and "nextHistoricalCheckpointLedger" is not null
		), cohort_bucket_hashes as materialized (
			select distinct dependency."bucketHash"
			from chain_cursor
			cross join lateral (
				${historyArchiveCheckpointBucketDependencyRangeSql(
					archiveUrlIdentitySql,
					'chain_cursor.first_checkpoint',
					'chain_cursor.last_checkpoint'
				)}
			) dependency
		)
		select ${candidateColumns}
		from "history_archive_object_queue" candidate
		where candidate."archiveUrlIdentity" = ${archiveUrlIdentitySql}
			and candidate."checkpointLedger" is null
			and ${eligible}
		union all
		select ${candidateColumns}
		from chain_cursor
		cross join lateral (
			select ${candidateColumns}
			from "history_archive_object_queue" candidate
			where candidate."archiveUrlIdentity" = ${archiveUrlIdentitySql}
				and candidate."checkpointLedger" between
					chain_cursor.first_checkpoint and chain_cursor.last_checkpoint
				and candidate."objectType" <> 'bucket'
				and ${eligible}
			offset 0
		) candidate
		union all
		select ${candidateColumns}
		from cohort_bucket_hashes dependency
		cross join lateral (
			select ${candidateColumns}
			from "history_archive_object_queue" candidate
			where candidate."archiveUrlIdentity" = ${archiveUrlIdentitySql}
				and candidate."bucketHash" = dependency."bucketHash"
				and candidate."objectType" = 'bucket'
				and candidate."checkpointLedger" is not null
				and ${eligible}
			offset 0
		) candidate
	`;
}
