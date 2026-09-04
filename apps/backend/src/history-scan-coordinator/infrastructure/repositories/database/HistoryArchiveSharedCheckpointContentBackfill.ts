import type { DataSource, EntityManager } from 'typeorm';
import { writeHistoryArchiveSharedCheckpointContentShadowWithManager } from './HistoryArchiveSharedCheckpointContentShadow.js';

export const sharedCheckpointBackfillName = 'shared-checkpoint-content-v1';
export const defaultSharedCheckpointScanBatchSize = 100_000;
export const defaultSharedCheckpointEligibleBatchSize = 500;
export const defaultSharedCheckpointWriteBatchSize = 500;

interface BackfillPageRow {
	readonly eligibleRows: string;
	readonly nextQueueId: string;
	readonly remoteIds: readonly string[];
	readonly scannedRows: string;
}

interface BackfillProgressRow {
	readonly completedAt: Date | null;
	readonly eligibleRows: string;
	readonly lastQueueId: string;
	readonly materializedRows: string;
	readonly scannedRows: string;
	readonly startedAt: Date;
	readonly updatedAt: Date;
}

interface BackfillStatusRow extends BackfillProgressRow {
	readonly conflictRows: number;
	readonly observationRows: number;
}

export interface SharedCheckpointBackfillPage {
	readonly complete: boolean;
	readonly cursorAfter: string;
	readonly cursorBefore: string;
	readonly durationMs: number;
	readonly eligibleRows: number;
	readonly materializedRows: number;
	readonly scannedRows: number;
}

export interface SharedCheckpointBackfillStatus {
	readonly completedAt: Date | null;
	readonly conflictRows: number;
	readonly eligibleRows: string;
	readonly lastQueueId: string;
	readonly materializedRows: string;
	readonly observationRows: number;
	readonly scannedRows: string;
	readonly startedAt: Date;
	readonly updatedAt: Date;
}

export async function backfillSharedCheckpointContentPage(
	dataSource: DataSource,
	scanBatchSize = defaultSharedCheckpointScanBatchSize,
	writeBatchSize = defaultSharedCheckpointWriteBatchSize,
	eligibleBatchSize = defaultSharedCheckpointEligibleBatchSize
): Promise<SharedCheckpointBackfillPage> {
	const startedAt = Date.now();
	const normalizedScanBatchSize =
		normalizeSharedCheckpointScanBatchSize(scanBatchSize);
	const normalizedWriteBatchSize =
		normalizeSharedCheckpointWriteBatchSize(writeBatchSize);
	const normalizedEligibleBatchSize =
		normalizeSharedCheckpointEligibleBatchSize(eligibleBatchSize);
	const result = await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '2s'`);
		await manager.query(`set local statement_timeout = '60s'`);
		await ensureProgressRow(manager);
		const [progress] = (await manager.query(
			`select "lastQueueId"::text as "lastQueueId"
			 from "history_archive_shared_checkpoint_backfill_progress"
			 where "name" = $1
			 for update`,
			[sharedCheckpointBackfillName]
		)) as readonly { readonly lastQueueId: string }[];

		if (progress === undefined) {
			throw new Error('Shared checkpoint backfill progress row is missing');
		}

		const [page] = (await manager.query(backfillPageSql, [
			progress.lastQueueId,
			normalizedScanBatchSize,
			normalizedEligibleBatchSize
		])) as readonly BackfillPageRow[];
		if (page === undefined) {
			throw new Error('Shared checkpoint backfill page query returned no row');
		}

		let materializedRows = 0;
		for (const remoteIds of chunks(
			page.remoteIds ?? [],
			normalizedWriteBatchSize
		)) {
			materializedRows +=
				await writeHistoryArchiveSharedCheckpointContentShadowWithManager(
					manager,
					remoteIds
				);
		}

		const scannedRows = Number(page.scannedRows);
		const eligibleRows = Number(page.eligibleRows);
		await manager.query(
			`update "history_archive_shared_checkpoint_backfill_progress"
			 set "lastQueueId" = $2::bigint,
			     "scannedRows" = "scannedRows" + $3::bigint,
			     "eligibleRows" = "eligibleRows" + $4::bigint,
			     "materializedRows" = "materializedRows" + $5::bigint,
			     "updatedAt" = now(),
			     "completedAt" = case when $3::bigint = 0
			                          then now() else null end
			 where "name" = $1`,
			[
				sharedCheckpointBackfillName,
				page.nextQueueId,
				scannedRows,
				eligibleRows,
				materializedRows
			]
		);

		return {
			complete: scannedRows === 0,
			cursorAfter: page.nextQueueId,
			cursorBefore: progress.lastQueueId,
			eligibleRows,
			materializedRows,
			scannedRows
		};
	});
	return { ...result, durationMs: Date.now() - startedAt };
}

export async function inspectSharedCheckpointBackfill(
	dataSource: DataSource
): Promise<SharedCheckpointBackfillStatus> {
	await ensureProgressRow(dataSource.manager);
	const [row] = (await dataSource.query(
		`select progress."lastQueueId"::text as "lastQueueId",
		     progress."scannedRows"::text as "scannedRows",
		     progress."eligibleRows"::text as "eligibleRows",
		     progress."materializedRows"::text as "materializedRows",
		     progress."startedAt", progress."updatedAt",
		     progress."completedAt",
		     (
		       select count(*)::integer
		       from "history_archive_checkpoint_content_observation"
		     ) as "observationRows",
		     (
		       select count(*)::integer
		       from "history_archive_checkpoint_content_conflict"
		     ) as "conflictRows"
		 from "history_archive_shared_checkpoint_backfill_progress" progress
		 where progress."name" = $1`,
		[sharedCheckpointBackfillName]
	)) as readonly BackfillStatusRow[];
	if (row === undefined) {
		throw new Error('Shared checkpoint backfill status is unavailable');
	}
	return row as SharedCheckpointBackfillStatus;
}

export function normalizeSharedCheckpointScanBatchSize(value: number): number {
	if (!Number.isFinite(value)) return defaultSharedCheckpointScanBatchSize;
	return Math.max(1_000, Math.min(500_000, Math.trunc(value)));
}

export function normalizeSharedCheckpointWriteBatchSize(value: number): number {
	if (!Number.isFinite(value)) return defaultSharedCheckpointWriteBatchSize;
	return Math.max(100, Math.min(2_500, Math.trunc(value)));
}

export function normalizeSharedCheckpointEligibleBatchSize(
	value: number
): number {
	if (!Number.isFinite(value)) return defaultSharedCheckpointEligibleBatchSize;
	return Math.max(100, Math.min(2_500, Math.trunc(value)));
}

async function ensureProgressRow(manager: EntityManager): Promise<void> {
	await manager.query(
		`insert into "history_archive_shared_checkpoint_backfill_progress" (
		     "name"
		   )
		   values ($1)
		   on conflict ("name") do nothing`,
		[sharedCheckpointBackfillName]
	);
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

const backfillPageSql = `
	with scanned as materialized (
		select object.id, object."remoteId", object."objectType",
			object.status, object."checkpointLedger"
		from "history_archive_object_queue" object
		where object.id > $1::bigint
		order by object.id
		limit $2
	), classified as materialized (
		select scanned.*,
			scanned."objectType" = 'checkpoint-state'
			and scanned.status = 'verified'
			and scanned."checkpointLedger" is not null as eligible
		from scanned
	), ranked as materialized (
		select classified.*,
			count(*) filter (where eligible) over (order by id)
				as "eligibleRank"
		from classified
	), page as materialized (
		select * from ranked where "eligibleRank" <= $3
	)
	select coalesce(max(page.id), $1::bigint)::text as "nextQueueId",
		count(*)::text as "scannedRows",
		count(*) filter (where page.eligible)::text as "eligibleRows",
		coalesce(
			array_agg(page."remoteId" order by page.id)
				filter (where page.eligible),
			array[]::uuid[]
		) as "remoteIds"
	from page
`;
