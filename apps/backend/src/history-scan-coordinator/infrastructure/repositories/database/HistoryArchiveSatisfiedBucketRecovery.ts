import type { DataSource } from 'typeorm';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';
import { hasPostgresSqlState } from './PostgresError.js';

interface TargetRow {
	readonly remoteId: string;
}
interface RecoveryState {
	blockedUntil: number;
	pending?: Promise<readonly TargetRow[]>;
}
const states = new WeakMap<DataSource, RecoveryState>();
const errorCooldownMs = 5 * 60_000;

// Optional historical repair discovery must not compete indefinitely with live
// completion work. These settings are transaction-local, not pool defaults.
export async function findSatisfiedBucketProofTargets(
	database: DataSource,
	limit: number,
	excluded: readonly string[]
): Promise<readonly TargetRow[]> {
	if (limit <= 0) return [];
	let state = states.get(database);
	if (state === undefined) {
		state = { blockedUntil: 0 };
		states.set(database, state);
	}
	let pending = state.pending;
	if (pending === undefined && Date.now() < state.blockedUntil) return [];
	if (pending === undefined) {
		const current = state;
		current.pending = (async () => {
			try {
				return await database.transaction(async (manager) => {
					await manager.query(
						"set transaction read only; set local statement_timeout='3s'; set local lock_timeout='250ms'; set local max_parallel_workers_per_gather=0"
					);
					return await manager.query<readonly TargetRow[]>(
						satisfiedBucketProofsSql,
						[limit, [...excluded]]
					);
				});
			} catch (error: unknown) {
				const code = ['57014', '55P03'].find((value) =>
					hasPostgresSqlState(error, value)
				);
				if (code === undefined) throw error;
				// Transaction rejection/rollback precedes the cooldown and result.
				current.blockedUntil = Date.now() + errorCooldownMs;
				database.logger.log(
					'warn',
					`Optional satisfied-bucket recovery deferred (${code}); retry after ${errorCooldownMs}ms`
				);
				return [];
			} finally {
				current.pending = undefined;
			}
		})();
		pending = current.pending;
	}
	const excludedIds = new Set(excluded);
	return (await pending)
		.filter((row) => !excludedIds.has(row.remoteId))
		.slice(0, limit);
}

export const satisfiedBucketProofsSql = `
	with proof_candidates as materialized (
		select distinct on (proof."archiveUrlIdentity")
			proof."archiveUrlIdentity", proof."checkpointLedger"
		from history_archive_checkpoint_proof proof
		where proof.status = 'not-evaluable'
			and proof."failureKind" = 'bucket-missing'
			and proof."requiredObjectsComplete" = true
			and proof."proofFactsComplete" = true
		order by proof."archiveUrlIdentity", proof."checkpointLedger" desc
	), satisfied as materialized (
		select candidate.*
		from proof_candidates candidate
		cross join lateral (
			select count(*) > 0 and bool_and(coalesce(
				bucket.status = 'verified'
				and bucket."verificationFacts"#>>'{bucketObject,matched}' = 'true'
				and lower(bucket."verificationFacts"#>>'{bucketObject,expectedBucketHash}') = expected."bucketHash"
				and bucket."verificationFacts"#>>'{bucketObject,sourceUrl}' = bucket."objectUrl",
				false)) as valid
			from lateral (
				${historyArchiveCheckpointBucketDependenciesSql(
					'candidate."archiveUrlIdentity"',
					'candidate."checkpointLedger"'
				)}
			) expected
			left join lateral (
				select bucket.status, bucket."verificationFacts", bucket."objectUrl"
				from history_archive_object_queue bucket
				where bucket."archiveUrlIdentity" = expected."archiveUrlIdentity"
					and bucket."objectKey" = 'bucket:' || expected."bucketHash"
					and bucket."objectType" = 'bucket'
					and bucket."bucketHash" = expected."bucketHash"
				limit 1
			) bucket on true
			where expected."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and expected."checkpointLedger" = candidate."checkpointLedger"
		) evidence
		where evidence.valid
	)
	select object."remoteId"
	from satisfied
	join history_archive_object_queue object
		on object."archiveUrlIdentity" = satisfied."archiveUrlIdentity"
		and object."checkpointLedger" = satisfied."checkpointLedger"
		and object."objectType" = 'checkpoint-state'
		and object.status = 'verified'
	where not (object."remoteId" = any($2::uuid[]))
		and (object."transitionEffectsRequiredAt" is null
			or object."transitionEffectsCompletedAt" is not null)
	order by object.id
	limit $1::integer
`;
