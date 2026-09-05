import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	getHistoryArchiveBrokerMaximumPriority,
	type HistoryArchiveBrokerPriority
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { normalizeLimit } from './HistoryArchiveObjectRowMapper.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';
import { historyArchiveSequentialPrefetchLedgerSpan } from './HistoryArchiveSequentialChainSql.js';

interface TransitionTargetRow {
	readonly remoteId: string;
}

export async function findPrioritizedHistoryArchiveObjectTransitions(
	repository: Repository<HistoryArchiveObject>,
	limit: number,
	maximumPriority: HistoryArchiveBrokerPriority = getHistoryArchiveBrokerMaximumPriority()
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const runtimeRows =
		maximumPriority === 2
			? ((await repository.manager.query(frontierTransitionsSql, [
					safeLimit
				])) as readonly TransitionTargetRow[])
			: ((await repository.manager.query(runtimeTransitionsSql, [
					safeLimit
				])) as readonly TransitionTargetRow[]);
	const remaining = safeLimit - runtimeRows.length;
	const genericRows =
		remaining <= 0 || maximumPriority === 0 || runtimeRows.length > 0
			? []
			: ((await repository.manager.query(
					genericTransitionsSqlByMaximumPriority[maximumPriority],
					[remaining, runtimeRows.map((row) => row.remoteId)]
				)) as readonly TransitionTargetRow[]);
	const rows = [...runtimeRows, ...genericRows];
	if (rows.length === 0) return [];

	const objects = await repository
		.createQueryBuilder('object')
		.where('object.remoteId in (:...remoteIds)', {
			remoteIds: rows.map((row) => row.remoteId)
		})
		.getMany();
	const byRemoteId = new Map(
		objects.map((object) => [object.remoteId, object])
	);
	return rows.flatMap((row) => {
		const object = byRemoteId.get(row.remoteId);
		return object === undefined ? [] : [object];
	});
}

const terminalTransitionPredicateSql = `
	object.status in ('verified', 'failed')
	and object."transitionEffectsRequiredAt" is not null
	and object."transitionEffectsCompletedAt" is null
`;

// Frontier work must not wait behind historical terminal rows. Those rows remain
// durable and are drained by the generic remainder after the current bottom-up
// cohort has been reconciled.
export const frontierTransitionsSql = `
	select object."remoteId"
	from "history_archive_checkpoint_scan_cursor" chain_cursor
	join "history_archive_object_queue" object
		on object."archiveUrlIdentity" = chain_cursor."archiveUrlIdentity"
		and object."checkpointLedger" between
			chain_cursor."nextHistoricalCheckpointLedger" - 64
			and chain_cursor."nextHistoricalCheckpointLedger" - 64 +
				${historyArchiveSequentialPrefetchLedgerSpan}
	where ${terminalTransitionPredicateSql}
	order by object."checkpointLedger" -
		(chain_cursor."nextHistoricalCheckpointLedger" - 64),
		case object."objectType"
			when 'checkpoint-state' then 0
			when 'ledger' then 1
			when 'transactions' then 2
			when 'results' then 3
			when 'bucket' then 4
			else 5
		end,
		object."transitionEffectsRequiredAt",
		object.id
	limit $1::integer
`;
const runtimeTransitionsSql = `
	with ${canonicalRuntimeTargetCtes}, runtime_roots as materialized (
		select state."archiveUrlIdentity", target.checkpoint_ledger,
			target.target_lane
		from runtime_target target
		join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				target."network_passphrase_hash"
	), runtime_keys as materialized (
		select root."archiveUrlIdentity", root.target_lane,
			desired.object_type, desired.object_key
		from runtime_roots root
		cross join lateral (
			values
				('checkpoint-state', 'checkpoint-state:' || lpad(
					to_hex(root.checkpoint_ledger), 8, '0')),
				('checkpoint-state', 'checkpoint-state:' || lpad(
					to_hex(root.checkpoint_ledger - 64), 8, '0')),
				('ledger', 'ledger:' || lpad(
					to_hex(root.checkpoint_ledger - 64), 8, '0')),
				('ledger', 'ledger:' || lpad(
					to_hex(root.checkpoint_ledger), 8, '0')),
				('transactions', 'transactions:' || lpad(
					to_hex(root.checkpoint_ledger), 8, '0')),
				('results', 'results:' || lpad(
					to_hex(root.checkpoint_ledger), 8, '0'))
		) desired(object_type, object_key)
		where root.checkpoint_ledger >= 63
		union all
		select root."archiveUrlIdentity", root.target_lane,
			'bucket'::text, 'bucket:' || dependency."bucketHash"
		from runtime_roots root
		join lateral (
			${historyArchiveCheckpointBucketDependenciesSql(
				'root."archiveUrlIdentity"',
				'root.checkpoint_ledger'
			)}
		) dependency
			on dependency."archiveUrlIdentity" = root."archiveUrlIdentity"
			and dependency."checkpointLedger" = root.checkpoint_ledger
	), runtime_candidates as materialized (
		select object."remoteId", object.id,
			min(
				case target.target_lane
					when 'forward' then 0
					else 1
				end
			)
				as lane_priority,
			case object."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end as reason_priority,
			object."transitionEffectsRequiredAt" as required_at
		from runtime_keys target
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = target."archiveUrlIdentity"
			and object."objectType" = target.object_type
			and object."objectKey" = target.object_key
		where ${terminalTransitionPredicateSql}
		group by object."remoteId", object.id, object."executionReason",
			object."transitionEffectsRequiredAt"
	)
	select "remoteId"
	from runtime_candidates
	order by lane_priority, reason_priority, required_at, id
	limit $1::integer
`;

const genericTransitionsSql = `
	select object."remoteId"
	from "history_archive_object_queue" object
	where ${terminalTransitionPredicateSql}
		and not (object."remoteId" = any($2::uuid[]))
	order by
		case object."executionReason"
			when 'canonical-frontier-reserve' then 0
			when 'proof-completion-reserve' then 1
			else 2
		end,
		object."transitionEffectsRequiredAt",
		object.id
	limit $1::integer
`;

// Priority zero is derived exclusively from the current runtime target CTEs.
// A persisted canonical-frontier-reserve reason is historical scheduling state;
// it must not make an unrelated terminal row current canonical work. Priority one
// admits only proof-completion reserve effects. Priority two preserves the legacy
// behavior and drains every remaining terminal effect.
const proofCompletionTransitionsSql = `
	select object."remoteId"
	from "history_archive_object_queue" object
	where ${terminalTransitionPredicateSql}
		and case object."executionReason"
			when 'canonical-frontier-reserve' then 0
			when 'proof-completion-reserve' then 1
			else 2
		end = 1
		and not (object."remoteId" = any($2::uuid[]))
	order by object."transitionEffectsRequiredAt", object.id
	limit $1::integer
`;

const genericTransitionsSqlByMaximumPriority: Readonly<
	Record<Exclude<HistoryArchiveBrokerPriority, 0>, string>
> = {
	1: proofCompletionTransitionsSql,
	2: genericTransitionsSql
};
