import type { DataSource } from 'typeorm';

export interface HistoryArchiveCheckpointProofRefreshSeedResult {
	readonly batchEndProofId: string;
	readonly complete: boolean;
	readonly cutoffProofId: string;
	readonly enqueuedProofs: number;
	readonly lastProofId: string;
	readonly scannedProofs: number;
}

export const defaultProofRefreshSeedBatchSize = 500;
export const maximumProofRefreshSeedBatchSize = 5_000;

export async function inspectHistoryArchiveCheckpointProofRefreshSeed(
	dataSource: DataSource,
	batchSize: number
): Promise<HistoryArchiveCheckpointProofRefreshSeedResult> {
	const [row] = (await dataSource.query(inspectSeedBatchSql, [
		normalizeProofRefreshSeedBatchSize(batchSize)
	])) as readonly SeedResultRow[];
	return mapSeedResult(row);
}

export async function seedHistoryArchiveCheckpointProofRefreshes(
	dataSource: DataSource,
	batchSize: number
): Promise<HistoryArchiveCheckpointProofRefreshSeedResult> {
	return await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '2s'`);
		await manager.query(`set local statement_timeout = '30s'`);
		await manager.query(initializeSeedProgressSql);
		const [row] = (await manager.query(seedBatchSql, [
			normalizeProofRefreshSeedBatchSize(batchSize)
		])) as readonly SeedResultRow[];
		return mapSeedResult(row);
	});
}

export function normalizeProofRefreshSeedBatchSize(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		return defaultProofRefreshSeedBatchSize;
	}
	return Math.min(value, maximumProofRefreshSeedBatchSize);
}

interface SeedResultRow {
	readonly batchEndProofId?: number | string;
	readonly batchendproofid?: number | string;
	readonly complete?: boolean;
	readonly cutoffProofId?: number | string;
	readonly cutoffproofid?: number | string;
	readonly enqueuedProofs?: number | string;
	readonly enqueuedproofs?: number | string;
	readonly lastProofId?: number | string;
	readonly lastproofid?: number | string;
	readonly scannedProofs?: number | string;
	readonly scannedproofs?: number | string;
}

function mapSeedResult(
	row: SeedResultRow | undefined
): HistoryArchiveCheckpointProofRefreshSeedResult {
	if (row === undefined)
		throw new Error('Proof refresh seed returned no result');
	return {
		batchEndProofId: String(row.batchEndProofId ?? row.batchendproofid ?? '0'),
		complete: row.complete === true,
		cutoffProofId: String(row.cutoffProofId ?? row.cutoffproofid ?? '0'),
		enqueuedProofs: Number(row.enqueuedProofs ?? row.enqueuedproofs ?? 0),
		lastProofId: String(row.lastProofId ?? row.lastproofid ?? '0'),
		scannedProofs: Number(row.scannedProofs ?? row.scannedproofs ?? 0)
	};
}

const staleFailureTargetsCteSql = `
	stale_targets as materialized (
		select proof."archiveUrlIdentity", proof."checkpointLedger",
			max(greatest(
				object."updatedAt",
				coalesce(object."verifiedAt", '-infinity'::timestamptz)
			)) as evidence_updated_at
		from proof_batch proof
		cross join lateral jsonb_array_elements(
			case
				when jsonb_typeof(proof.details->'objectFailures') = 'array'
				then proof.details->'objectFailures'
				else '[]'::jsonb
			end
		) failure
		join history_archive_object_queue object
			on object."remoteId" = case
				when failure->>'remoteId' ~
					'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
				then (failure->>'remoteId')::uuid
			end
			and object.status = 'verified'
		group by proof."archiveUrlIdentity", proof."checkpointLedger"
	)
`;

const seedQueueUpsertCteSql = `
	, enqueued as (
		insert into history_archive_checkpoint_proof_refresh_queue (
			"archiveUrlIdentity", "checkpointLedger", "evidenceUpdatedAt", generation,
			"requestedAt", "nextAttemptAt", "updatedAt"
		)
		select "archiveUrlIdentity", "checkpointLedger", evidence_updated_at, 1,
			now(), now(), now()
		from stale_targets
		on conflict ("archiveUrlIdentity", "checkpointLedger") do update set
			"evidenceUpdatedAt" = greatest(
				history_archive_checkpoint_proof_refresh_queue."evidenceUpdatedAt",
				excluded."evidenceUpdatedAt"
			),
			"nextAttemptAt" = least(
				history_archive_checkpoint_proof_refresh_queue."nextAttemptAt",
				now()
			),
			generation =
				history_archive_checkpoint_proof_refresh_queue.generation + 1,
			attempts = 0,
			"lastError" = null,
			"leaseToken" = null,
			"leaseUntil" = null,
			"updatedAt" = now()
		returning 1
	)
`;

export const initializeSeedProgressSql = `
	insert into history_archive_checkpoint_proof_refresh_seed_progress (
		id, "cutoffProofId", "lastProofId", complete, "startedAt", "updatedAt"
	)
	select 1, coalesce(max(id), 0), 0, false, now(), now()
	from history_archive_checkpoint_proof
	on conflict (id) do nothing
`;

export const seedBatchSql = `
	with progress as materialized (
		select *
		from history_archive_checkpoint_proof_refresh_seed_progress
		where id = 1
		for update
	), proof_batch as materialized (
		select proof.id, proof."archiveUrlIdentity", proof."checkpointLedger",
			proof.details
		from history_archive_checkpoint_proof proof
		cross join progress
		where not progress.complete
			and proof.id > progress."lastProofId"
			and proof.id <= progress."cutoffProofId"
		order by proof.id
		limit $1::integer
	), ${staleFailureTargetsCteSql}
	${seedQueueUpsertCteSql}
	, advanced as (
		update history_archive_checkpoint_proof_refresh_seed_progress seed
		set "lastProofId" = greatest(
				seed."lastProofId",
				coalesce((select max(id) from proof_batch), seed."cutoffProofId")
			),
			complete = coalesce(
				(select max(id) from proof_batch), seed."cutoffProofId"
			) >= seed."cutoffProofId",
			"updatedAt" = now()
		where seed.id = 1
		returning seed.*
	)
	select advanced."cutoffProofId", advanced."lastProofId", advanced.complete,
		coalesce((select max(id) from proof_batch), advanced."lastProofId")
			as "batchEndProofId",
		(select count(*)::integer from proof_batch) as "scannedProofs",
		(select count(*)::integer from enqueued) as "enqueuedProofs"
	from advanced
`;

export const inspectSeedBatchSql = `
	with persisted as materialized (
		select *
		from history_archive_checkpoint_proof_refresh_seed_progress
		where id = 1
	), progress as materialized (
		select "cutoffProofId", "lastProofId", complete
		from persisted
		union all
		select coalesce(max(id), 0), 0, false
		from history_archive_checkpoint_proof
		where not exists (select 1 from persisted)
	), proof_batch as materialized (
		select proof.id, proof."archiveUrlIdentity", proof."checkpointLedger",
			proof.details
		from history_archive_checkpoint_proof proof
		cross join progress
		where not progress.complete
			and proof.id > progress."lastProofId"
			and proof.id <= progress."cutoffProofId"
		order by proof.id
		limit $1::integer
	), ${staleFailureTargetsCteSql}
	select progress."cutoffProofId", progress."lastProofId",
		(coalesce(
			(select max(id) from proof_batch), progress."cutoffProofId"
		) >= progress."cutoffProofId") as complete,
		coalesce((select max(id) from proof_batch), progress."cutoffProofId")
			as "batchEndProofId",
		(select count(*)::integer from proof_batch) as "scannedProofs",
		(select count(*)::integer from stale_targets) as "enqueuedProofs"
	from progress
`;
