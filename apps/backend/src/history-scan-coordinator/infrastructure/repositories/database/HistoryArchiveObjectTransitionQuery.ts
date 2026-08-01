import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { normalizeLimit } from './HistoryArchiveObjectRowMapper.js';

interface TransitionTargetRow {
	readonly remoteId: string;
}

export async function findPrioritizedHistoryArchiveObjectTransitions(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const rows = (await repository.manager.query(prioritizedTransitionsSql, [
		safeLimit
	])) as readonly TransitionTargetRow[];
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

const prioritizedTransitionsSql = `
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
		join "history_archive_checkpoint_bucket_dependency" dependency
			on dependency."archiveUrlIdentity" = root."archiveUrlIdentity"
			and dependency."checkpointLedger" = root.checkpoint_ledger
	), runtime_candidates as materialized (
		select object."remoteId", object.id,
			min(case target.target_lane when 'forward' then 0 else 1 end)
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
	), generic_candidates as materialized (
		select object."remoteId", object.id,
			case object."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end as reason_priority,
			object."transitionEffectsRequiredAt" as required_at
		from "history_archive_object_queue" object
		where ${terminalTransitionPredicateSql}
			and not exists (
				select 1 from runtime_candidates runtime
				where runtime.id = object.id
			)
		order by reason_priority, required_at, object.id
		limit $1::integer
	), prioritized as (
		select runtime."remoteId", runtime.id, 0 as target_priority,
			runtime.lane_priority, runtime.reason_priority, runtime.required_at
		from runtime_candidates runtime
		union all
		select generic."remoteId", generic.id, 1 as target_priority,
			2 as lane_priority, generic.reason_priority, generic.required_at
		from generic_candidates generic
	)
	select "remoteId"
	from prioritized
	order by target_priority, lane_priority, reason_priority, required_at, id
	limit $1::integer
`;
