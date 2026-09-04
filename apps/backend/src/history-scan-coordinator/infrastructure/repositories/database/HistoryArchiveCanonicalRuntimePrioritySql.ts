import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

function buildCanonicalRuntimeArchiveRootsCteSql(
	cteName: string,
	dueQueueAlias?: string
): string {
	const dueQueueJoin =
		dueQueueAlias === undefined
			? ''
			: `join ${dueQueueAlias} due_queue
			on due_queue."archiveUrlIdentity" = state."archiveUrlIdentity"
			and due_queue."checkpointLedger" = target.checkpoint_ledger`;
	return `
	${cteName} as materialized (
		select state."archiveUrlIdentity", target.checkpoint_ledger,
			target.target_lane,
			(
				checkpoint.status = 'verified'
				or (
					checkpoint.status = 'pending'
					and checkpoint."executionReason" =
						'canonical-proof-revalidation'
				)
			) as checkpoint_phase_ready
		from runtime_target target
		join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				target."network_passphrase_hash"
		${dueQueueJoin}
		join "history_archive_object_queue" checkpoint
			on checkpoint."archiveUrlIdentity" = state."archiveUrlIdentity"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint."checkpointLedger" = target.checkpoint_ledger
			and checkpoint."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(target.checkpoint_ledger), 8, '0')
	)
`;
}

export const canonicalRuntimeArchiveRootsCteSql =
	buildCanonicalRuntimeArchiveRootsCteSql('canonical_runtime_archive_roots');

export const dueProofRefreshCanonicalRuntimeArchiveRootsCteSql =
	buildCanonicalRuntimeArchiveRootsCteSql(
		'queued_canonical_runtime_roots',
		'due_proof_refresh_queue'
	);

export const canonicalRuntimePriorityCtesSql = `
	${canonicalRuntimeTargetCtes}, ${canonicalRuntimeArchiveRootsCteSql}
`;

export function canonicalRuntimeObjectMembershipSql(
	objectAlias: string
): string {
	return `exists (
		select 1
		from canonical_runtime_archive_roots runtime_root
		where runtime_root."archiveUrlIdentity" =
			${objectAlias}."archiveUrlIdentity"
			and ${canonicalRuntimeObjectMembershipForRootSql(objectAlias, 'runtime_root')}
	)`;
}

export function canonicalRuntimeObjectMembershipForRootSql(
	objectAlias: string,
	runtimeRootAlias: string
): string {
	return `(
				(
					${objectAlias}."objectType" = 'checkpoint-state'
					and ${objectAlias}."checkpointLedger" =
						${runtimeRootAlias}.checkpoint_ledger
					and ${objectAlias}."objectKey" = 'checkpoint-state:' ||
						lpad(to_hex(${runtimeRootAlias}.checkpoint_ledger), 8, '0')
				)
				or (
					${runtimeRootAlias}.checkpoint_phase_ready
					and (
						(
							${objectAlias}."objectType" = 'checkpoint-state'
							and ${objectAlias}."checkpointLedger" =
								${runtimeRootAlias}.checkpoint_ledger - 64
							and ${objectAlias}."objectKey" =
								'checkpoint-state:' || lpad(to_hex(
									${runtimeRootAlias}.checkpoint_ledger - 64
								), 8, '0')
						)
						or (
							${objectAlias}."objectType" = 'ledger'
							and ${objectAlias}."checkpointLedger" in (
								${runtimeRootAlias}.checkpoint_ledger,
								${runtimeRootAlias}.checkpoint_ledger - 64
							)
							and ${objectAlias}."objectKey" = 'ledger:' || lpad(
								to_hex(${objectAlias}."checkpointLedger"), 8, '0'
							)
						)
						or (
							${objectAlias}."objectType" in (
								'transactions', 'results'
							)
							and ${objectAlias}."checkpointLedger" =
								${runtimeRootAlias}.checkpoint_ledger
							and ${objectAlias}."objectKey" =
								${objectAlias}."objectType" || ':' || lpad(
									to_hex(${runtimeRootAlias}.checkpoint_ledger), 8, '0'
								)
						)
						or (
							${objectAlias}."objectType" = 'bucket'
							and ${objectAlias}."bucketHash" is not null
							and ${objectAlias}."objectKey" =
								'bucket:' || ${objectAlias}."bucketHash"
							and exists (
								select 1
								from lateral (
									${historyArchiveCheckpointBucketDependenciesSql(
										objectAlias + '."archiveUrlIdentity"',
										runtimeRootAlias + '.checkpoint_ledger'
									)}
								) dependency
								where dependency."archiveUrlIdentity" =
										${objectAlias}."archiveUrlIdentity"
									and dependency."checkpointLedger" =
										${runtimeRootAlias}.checkpoint_ledger
									and dependency."bucketHash" =
										${objectAlias}."bucketHash"
							)
						)
					)
				)
			)`;
}

export function historyArchiveEffectivePrioritySql(
	objectAlias: string
): string {
	return `case
		when ${objectAlias}."executionReason" = 'canonical-frontier-reserve'
			and ${canonicalRuntimeObjectMembershipSql(objectAlias)}
			then 0
		when ${objectAlias}."executionReason" = 'proof-completion-reserve'
			then 1
		else 2
	end::smallint`;
}

export function historyArchiveReservationPrioritySql(
	readyAlias: string,
	objectAlias: string
): string {
	return `case
		when ${readyAlias}."dispatchToken" is not null
			then ${readyAlias}.priority
		else ${historyArchiveEffectivePrioritySql(objectAlias)}
	end::smallint`;
}
