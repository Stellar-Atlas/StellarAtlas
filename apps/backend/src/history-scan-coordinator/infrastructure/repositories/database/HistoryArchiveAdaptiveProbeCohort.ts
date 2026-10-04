import type { EntityManager } from 'typeorm';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

/** Exact pending control point only. A successful point may retain its already
 * materialized children through a trusted, point-scoped activation below. */
export function historyArchiveAdaptiveProbeCohortSql(alias: string): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid probe SQL alias');
	return `(${alias}."executionReason" = 'adaptive-probe-dependency' or exists (
		select 1 from history_archive_root_failure_control control
		where control."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
			and control.scope = ${alias}."objectType"
			and control."adaptiveProbeState" is not null
			and control."nextProbeCheckpoint" = ${alias}."checkpointLedger"
	))`;
}

interface ActivationReceipt {
	readonly activated: number;
	readonly ready: number;
	readonly materialized: boolean;
}

/** Does not discover objects, advance the contiguous cursor, or write coverage.
 * Only normal, already materialized dependencies of this verified point qualify.
 * The marker is admission provenance, never replacement verification/proof data. */
export async function activateAdaptiveProbeCheckpointDependencies(
	manager: EntityManager,
	archiveUrlIdentity: string,
	checkpointLedger: number
): Promise<ActivationReceipt> {
	if (
		!Number.isSafeInteger(checkpointLedger) ||
		checkpointLedger < 63 ||
		checkpointLedger > 2_147_483_647 ||
		checkpointLedger % 64 !== 63
	)
		throw new Error('Invalid adaptive checkpoint');
	const [result] = (await manager.query(activateAdaptiveProbeDependenciesSql, [
		archiveUrlIdentity,
		checkpointLedger
	])) as readonly ActivationReceipt[];
	if (!result) throw new Error('Missing adaptive activation receipt');
	if (result.ready > 0)
		await manager.query('select pg_notify($1,$2)', [
			'stellaratlas_history_archive_ready',
			'ready'
		]);
	return result;
}

export const activateAdaptiveProbeDependenciesSql = `
	with checkpoint as materialized (
		select object."archiveUrlIdentity", object."checkpointLedger"
		from history_archive_object_queue object
		where object."archiveUrlIdentity" = $1 and object."objectType" = 'checkpoint-state'
			and object."objectKey" = 'checkpoint-state:' || lpad(to_hex($2::integer),8,'0')
			and object."checkpointLedger" = $2 and object.status = 'verified'
			and object."dependenciesMaterializedAt" is not null
			and (object."transitionEffectsRequiredAt" is null or object."transitionEffectsCompletedAt" is not null)
			and exists (select 1 from history_archive_root_failure_control control
				where control."archiveUrlIdentity" = object."archiveUrlIdentity"
					and control.scope = 'checkpoint-state'
					and control."adaptiveProbeState" is not null and control."nextProbeCheckpoint" = $2)
	), keys as materialized (
		select checkpoint."archiveUrlIdentity", category.kind as object_type,
			category.kind || ':' || lpad(to_hex($2::integer),8,'0') as object_key
		from checkpoint cross join (values ('ledger'),('transactions'),('results'),('scp')) category(kind)
		union all
		select checkpoint."archiveUrlIdentity", 'bucket', 'bucket:' || dependency."bucketHash"
		from checkpoint cross join lateral (
			${historyArchiveCheckpointBucketDependenciesSql('checkpoint."archiveUrlIdentity"', 'checkpoint."checkpointLedger"')}
		) dependency
	), blocked_dependencies as materialized (
		select 1 from keys join history_archive_object_queue object
			on object."archiveUrlIdentity"=keys."archiveUrlIdentity"
			and object."objectType"=keys.object_type and object."objectKey"=keys.object_key
		where object.status='pending' and object."executionDisposition" is distinct from 'superseded'
			and (object."dependencyReady" is distinct from true
				or (object."transitionEffectsRequiredAt" is not null and object."transitionEffectsCompletedAt" is null))
		limit 1
	), candidate_keys as materialized (
		select object."remoteId" from keys
		join history_archive_object_queue object
			on object."archiveUrlIdentity" = keys."archiveUrlIdentity"
			and object."objectType" = keys.object_type and object."objectKey" = keys.object_key
		where object.status = 'pending' and object."dependencyReady" = true
			and object."executionDisposition" is distinct from 'superseded'
			and (object."transitionEffectsRequiredAt" is null or object."transitionEffectsCompletedAt" is not null)
			and not exists (select 1 from history_archive_object_ready ready
				where ready."objectRemoteId"=object."remoteId" and ready."dispatchToken" is not null)
			and (object."executionReason" is distinct from 'adaptive-probe-dependency'
				or not exists (select 1 from history_archive_object_ready ready
					where ready."objectRemoteId"=object."remoteId"))
		order by object."remoteId" limit 128
	), ready_lockable as materialized (
		-- Terminal callbacks lock ready before queue. Preserve that order here.
		select ready."objectRemoteId" from history_archive_object_ready ready
		join candidate_keys candidate on candidate."remoteId"=ready."objectRemoteId"
		where ready."dispatchToken" is null
		order by ready."objectRemoteId" for update of ready skip locked
	), candidates as materialized (
		select object."remoteId" from candidate_keys candidate
		join history_archive_object_queue object on object."remoteId"=candidate."remoteId"
		where not exists (select 1 from history_archive_object_ready ready
			where ready."objectRemoteId"=object."remoteId")
			or exists (select 1 from ready_lockable ready where ready."objectRemoteId"=object."remoteId")
		order by object."remoteId"
		for update of object skip locked
	), activated as (
		update history_archive_object_queue object set "executionDisposition"='executable',
			"executionReason"='adaptive-probe-dependency', "executionDispositionAt"=now(),"updatedAt"=now()
		from candidates where candidates."remoteId"=object."remoteId"
			and (object."executionDisposition" is distinct from 'executable'
				or object."executionReason" is distinct from 'adaptive-probe-dependency')
		returning object."remoteId"
	), ready as (
		insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"availableAt","createdAt","updatedAt")
		select candidates."remoteId",$1,2,now(),now(),now() from candidates
		on conflict ("objectRemoteId") do nothing returning "objectRemoteId"
	)
	select (select count(*)::integer from activated) as activated,
		(select count(*)::integer from ready) as ready,
		(exists (select 1 from checkpoint)
			and not exists (select 1 from blocked_dependencies)
			and (select count(*) from candidate_keys) < 128
			and (select count(*) from candidates) = (select count(*) from candidate_keys)) as materialized
`;
