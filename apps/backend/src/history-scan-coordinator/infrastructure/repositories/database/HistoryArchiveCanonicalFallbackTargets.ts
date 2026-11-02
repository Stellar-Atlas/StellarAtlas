import type { EntityManager } from 'typeorm';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';
import { getCanonicalFallbackRoot } from './HistoryArchiveCanonicalFallbackAnchorSql.js';
import { remoteCheckpointFailureExistsSql } from './HistoryArchiveCheckpointRemoteFailureSql.js';
import { canonicalVerifiedBoundarySql } from './HistoryArchiveCanonicalFallbackAnchorSql.js';

/** Admit one sibling SDF checkpoint-state object for the canonical frontier. */
export const materializeCanonicalFrontierAlternateCheckpointSql = `
with canonical as materialized (
	select canonical_state."networkPassphrase" as network_passphrase,
		canonical_cursor."nextHistoricalCheckpointLedger" - 64 as checkpoint_ledger,
		canonical_cursor."archiveUrlIdentity" as canonical_identity,
		canonical_state."currentLedger" as canonical_current_ledger
	from "history_archive_checkpoint_scan_cursor" canonical_cursor
	join "history_archive_state_snapshot" canonical_state
		on canonical_state."archiveUrlIdentity" =
			canonical_cursor."archiveUrlIdentity"
	where canonical_cursor."archiveUrlIdentity" = $1::text
		and canonical_state.status = 'available'
		and canonical_state."networkPassphrase" is not null
		and canonical_cursor."nextHistoricalCheckpointLedger" is not null
), failed_frontier as materialized (
	select canonical.*,
		regexp_replace(canonical.canonical_identity, '[0-9]+$', '')
			as source_family_prefix
	from canonical
	join "history_archive_checkpoint_proof" failed_proof
		on failed_proof."archiveUrlIdentity" = canonical.canonical_identity
		and failed_proof."checkpointLedger" = canonical.checkpoint_ledger
		and failed_proof.status = 'not-evaluable'
		and failed_proof."failureKind" = 'object-failed'
	cross join lateral (
		${canonicalVerifiedBoundarySql(
			'canonical.canonical_identity',
			'canonical.checkpoint_ledger - 64'
		)}
	) predecessor_proof
	where canonical.checkpoint_ledger <= canonical.canonical_current_ledger
		and ${remoteCheckpointFailureExistsSql('failed_proof')}
), available_alternates as materialized (
	select state."archiveUrlIdentity", root."archiveUrl",
		state."networkPassphrase", state."currentLedger",
		root."hostIdentity", frontier.checkpoint_ledger,
		frontier.canonical_identity,
		existing."remoteId" as existing_remote_id,
		existing.status as existing_status,
		existing."executionReason" as existing_execution_reason,
		left(state."archiveUrlIdentity",
			char_length(frontier.source_family_prefix)) =
			frontier.source_family_prefix
			and substring(state."archiveUrlIdentity" from
				char_length(frontier.source_family_prefix) + 1) ~ '^[0-9]+$'
			as priority_sdf_family
	from failed_frontier frontier
	join "history_archive_state_snapshot" state
		on state.status = 'available'
		and state."networkPassphrase" = frontier.network_passphrase
		and state."currentLedger" >= frontier.checkpoint_ledger
		and state."archiveUrlIdentity" <> frontier.canonical_identity
	join "history_archive_object_queue" root
		on root."archiveUrlIdentity" = state."archiveUrlIdentity"
		and root."objectType" = 'history-archive-state'
		and root."objectKey" = 'root'
		and root.status = 'verified'
	left join lateral (
		select object."remoteId", object.status, object."executionReason"
		from "history_archive_object_queue" object
		where object."archiveUrlIdentity" = state."archiveUrlIdentity"
			and object."objectType" = 'checkpoint-state'
			and object."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(frontier.checkpoint_ledger), 8, '0')
		limit 1
	) existing on true
), selected as materialized (
	select alternate.*
	from available_alternates alternate
	where alternate.existing_remote_id is null
		and not exists (
			select 1
			from available_alternates active_alternate
			where active_alternate.existing_execution_reason =
				'canonical-frontier-alternate'
				and (
					active_alternate.existing_status in ('pending', 'scanning')
					or (
						active_alternate.existing_status = 'verified'
						and not exists (
							select 1
							from "history_archive_checkpoint_proof" evaluated
							where evaluated."archiveUrlIdentity" =
								active_alternate."archiveUrlIdentity"
								and evaluated."checkpointLedger" =
									active_alternate.checkpoint_ledger
								and (
									evaluated.status = 'mismatch'
									or (
										evaluated.status = 'not-evaluable'
										and evaluated."failureKind" = 'object-failed'
										and ${remoteCheckpointFailureExistsSql('evaluated')}
									)
								)
							)
						)
					)
				)
		and not exists (
			select 1
			from available_alternates completed
			join "history_archive_checkpoint_proof" successful_proof
				on successful_proof."archiveUrlIdentity" =
					completed."archiveUrlIdentity"
				and successful_proof."checkpointLedger" =
					completed.checkpoint_ledger
			and successful_proof.status = 'verified'
			and successful_proof."requiredObjectsComplete" = true
			and successful_proof."proofFactsComplete" = true
			and successful_proof."failureKind" is null
			and coalesce(successful_proof."failedBucketCount", 0) = 0
		)
	order by alternate.priority_sdf_family desc,
		alternate."currentLedger" desc,
		alternate."archiveUrlIdentity"
	limit 1
), inserted as (
	insert into "history_archive_object_queue" (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
		"objectType", "objectKey", "objectOrder", "objectUrl",
		status, "checkpointLedger", "dependencyReady",
		"executionDisposition", "executionReason",
		"executionDispositionAt", "createdAt", "updatedAt"
	)
	select gen_random_uuid(), selected."archiveUrl",
		selected."archiveUrlIdentity", selected."hostIdentity",
		'checkpoint-state', 'checkpoint-state:' || lpad(
			to_hex(selected.checkpoint_ledger), 8, '0'
		), 10,
		rtrim(selected."archiveUrl", '/') || '/history/' ||
			substring(hex.value from 1 for 2) || '/' ||
			substring(hex.value from 3 for 2) || '/' ||
			substring(hex.value from 5 for 2) || '/' ||
			'history-' || hex.value || '.json',
		'pending', selected.checkpoint_ledger, true,
		'executable', 'canonical-frontier-alternate', now(), now(), now()
	from selected
	cross join lateral (
		select lpad(to_hex(selected.checkpoint_ledger), 8, '0') as value
	) hex
	on conflict ("archiveUrlIdentity", "objectType", "objectKey")
		do nothing
	returning "remoteId", "archiveUrlIdentity"
), ready as (
	insert into "history_archive_object_ready" (
		"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
		"createdAt", "updatedAt"
	)
	select inserted."remoteId", inserted."archiveUrlIdentity", 1, now(),
		now(), now()
	from inserted
	on conflict ("objectRemoteId") do nothing
	returning "objectRemoteId"
)
select count(*)::integer as inserted from inserted
`;

export interface CanonicalFrontierAlternateTarget {
	readonly remoteId: string;
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}

export interface CanonicalFrontierAlternateCompletion {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}

export const canonicalFrontierAlternateTargetsSql = `
with canonical as materialized (
	select cursor."archiveUrlIdentity", cursor."nextHistoricalCheckpointLedger" - 64
		as checkpoint_ledger, state."networkPassphrase"
	from "history_archive_checkpoint_scan_cursor" cursor
	join "history_archive_state_snapshot" state
		on state."archiveUrlIdentity" = cursor."archiveUrlIdentity"
		and state.status = 'available'
	where cursor."archiveUrlIdentity" = $1::text
		and cursor."nextHistoricalCheckpointLedger" is not null
), failed_frontier as materialized (
	select canonical.*
	from canonical
	join "history_archive_checkpoint_proof" failed
		on failed."archiveUrlIdentity" = canonical."archiveUrlIdentity"
		and failed."checkpointLedger" = canonical.checkpoint_ledger
		and failed.status = 'not-evaluable'
		and failed."failureKind" = 'object-failed'
	where ${remoteCheckpointFailureExistsSql('failed')}
		and exists (
			select 1
			from lateral (
				${canonicalVerifiedBoundarySql(
					'canonical."archiveUrlIdentity"',
					'canonical.checkpoint_ledger - 64'
				)}
			) predecessor
		)
), alternate_candidates as materialized (
	select alternate."remoteId", alternate."archiveUrlIdentity",
		alternate.status, frontier.checkpoint_ledger as "checkpointLedger"
	from failed_frontier frontier
	join "history_archive_state_snapshot" state
		on state.status = 'available'
		and state."networkPassphrase" = frontier."networkPassphrase"
		and state."currentLedger" >= frontier.checkpoint_ledger
		and state."archiveUrlIdentity" <> frontier."archiveUrlIdentity"
	join "history_archive_object_queue" root
		on root."archiveUrlIdentity" = state."archiveUrlIdentity"
		and root."objectType" = 'history-archive-state'
		and root."objectKey" = 'root'
		and root.status = 'verified'
	cross join lateral (
		select object."remoteId", object."archiveUrlIdentity",
			object.status, object."executionReason"
		from "history_archive_object_queue" object
		where object."archiveUrlIdentity" = state."archiveUrlIdentity"
			and object."objectType" = 'checkpoint-state'
			and object."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(frontier.checkpoint_ledger), 8, '0')
		limit 1
	) alternate
	where alternate."executionReason" = 'canonical-frontier-alternate'
		and (
			alternate.status in ('pending', 'scanning')
			or (
				alternate.status = 'verified'
				and not exists (
					select 1
					from "history_archive_checkpoint_proof" evaluated
					where evaluated."archiveUrlIdentity" = state."archiveUrlIdentity"
						and evaluated."checkpointLedger" = frontier.checkpoint_ledger
					and (
						evaluated.status = 'mismatch'
						or (
							evaluated.status = 'not-evaluable'
							and evaluated."failureKind" = 'object-failed'
							and ${remoteCheckpointFailureExistsSql('evaluated')}
						)
					)
				)
			)
		)
)
select alternate."remoteId", alternate."archiveUrlIdentity",
	alternate."checkpointLedger"
from alternate_candidates alternate
order by alternate."remoteId"
limit 1
`;

export const canonicalFrontierAlternateCanonicalCompletionsSql = `
with completed as materialized (
	select distinct input."archiveUrlIdentity", input."checkpointLedger"
	from jsonb_to_recordset($1::jsonb) as input(
		"archiveUrlIdentity" text,
		"checkpointLedger" integer
	)
), canonical as materialized (
	select cursor."archiveUrlIdentity", cursor."nextHistoricalCheckpointLedger" - 64
		as "checkpointLedger", state."networkPassphrase"
	from "history_archive_checkpoint_scan_cursor" cursor
	join "history_archive_state_snapshot" state
		on state."archiveUrlIdentity" = cursor."archiveUrlIdentity"
		and state.status = 'available'
	where cursor."archiveUrlIdentity" = $2::text
		and cursor."nextHistoricalCheckpointLedger" is not null
)
select canonical."archiveUrlIdentity", canonical."checkpointLedger"
from completed
join "history_archive_object_queue" alternate
	on alternate."archiveUrlIdentity" = completed."archiveUrlIdentity"
	and alternate."objectType" = 'checkpoint-state'
	and alternate."objectKey" = 'checkpoint-state:' ||
		lpad(to_hex(completed."checkpointLedger"), 8, '0')
	and alternate."executionReason" = 'canonical-frontier-alternate'
	and alternate.status = 'verified'
join "history_archive_checkpoint_proof" alternate_proof
	on alternate_proof."archiveUrlIdentity" = alternate."archiveUrlIdentity"
	and alternate_proof."checkpointLedger" = alternate."checkpointLedger"
	and alternate_proof.status = 'verified'
	and alternate_proof."requiredObjectsComplete" = true
	and alternate_proof."proofFactsComplete" = true
	and alternate_proof."failureKind" is null
	and coalesce(alternate_proof."failedBucketCount", 0) = 0
join "history_archive_state_snapshot" alternate_state
	on alternate_state."archiveUrlIdentity" = alternate."archiveUrlIdentity"
	and alternate_state.status = 'available'
join canonical
	on canonical."checkpointLedger" = alternate."checkpointLedger"
	and canonical."networkPassphrase" = alternate_state."networkPassphrase"
limit 1
`;

export async function materializeCanonicalFrontierAlternateCheckpoint(
	manager: EntityManager
): Promise<number> {
	const canonicalRoot = getCanonicalFallbackRoot();
	if (canonicalRoot === null) return 0;
	const [row] = (await manager.query(
		materializeCanonicalFrontierAlternateCheckpointSql,
		[canonicalRoot]
	)) as readonly { readonly inserted: number | string }[];
	const inserted = Number(row?.inserted ?? 0);
	if (inserted > 0) await notifyHistoryArchiveReadyWork(manager);
	return inserted;
}

export async function getCanonicalFrontierAlternateTargets(
	manager: Pick<EntityManager, 'query'>
): Promise<readonly CanonicalFrontierAlternateTarget[]> {
	const canonicalRoot = getCanonicalFallbackRoot();
	if (canonicalRoot === null) return [];
	return (await manager.query(canonicalFrontierAlternateTargetsSql, [
		canonicalRoot
	])) as readonly CanonicalFrontierAlternateTarget[];
}

export async function getCanonicalFrontierAlternateCanonicalCompletions(
	manager: Pick<EntityManager, 'query'>,
	completedTargets: readonly {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: number;
	}[]
): Promise<readonly CanonicalFrontierAlternateCompletion[]> {
	const canonicalRoot = getCanonicalFallbackRoot();
	if (canonicalRoot === null || completedTargets.length === 0) return [];
	return (await manager.query(
		canonicalFrontierAlternateCanonicalCompletionsSql,
		[JSON.stringify(completedTargets), canonicalRoot]
	)) as readonly CanonicalFrontierAlternateCompletion[];
}
