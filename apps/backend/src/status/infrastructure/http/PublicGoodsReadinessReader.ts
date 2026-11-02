import type { EntityManager } from 'typeorm';
import { historyArchivePublicSourcePredicateSql } from '../../../history-scan-coordinator/infrastructure/repositories/database/HistoryArchivePublicSourceScopeSql.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { quoteHubbleIdentifier } from './HubbleSemanticWarehouse.js';

export interface PublicationReadinessSnapshot {
	readonly generatedAt: string;
	readonly completedBatches: string;
	readonly totalRows: string;
	readonly latestCompletedAt: string | null;
}

export interface ArchiveReadinessSnapshot {
	readonly generatedAt: string;
	readonly sourceCount: number;
	readonly checkedRoots: number;
	readonly complete: boolean;
}

export interface PublicGoodsReadinessSnapshot {
	readonly catalog: PublicationReadinessSnapshot | null;
	readonly archiveSummary: ArchiveReadinessSnapshot | null;
}

export const archiveReadinessSql = `
SELECT count(DISTINCT "archiveUrl")::int AS known_roots,
 max("observedAt") AS latest_observed_at,
 count(DISTINCT "archiveUrl") FILTER (
  WHERE "observedAt">=CURRENT_TIMESTAMP-interval '24 hours'
   AND "observedAt"<=CURRENT_TIMESTAMP+interval '5 seconds'
 )::int AS recent_roots,
 count(*) FILTER (WHERE "observedAt" IS NULL)::int AS null_timestamp_rows
FROM history_archive_state_snapshot
WHERE ${historyArchivePublicSourcePredicateSql}`;

export function createPublicGoodsReadinessReader(config: {
	readonly warehouse: HubbleWarehouse;
	readonly manager: EntityManager;
}): () => Promise<PublicGoodsReadinessSnapshot> {
	const publication = cachedSource(async () => {
		const executor = config.warehouse.readModelExecutor?.();
		if (executor === undefined) throw new Error('Publication executor unavailable');
		const response = await executor.execute<Record<string, unknown>>(
			`SELECT
 toString(count()) AS manifest_rows,
 toString(countIf(status='complete')) AS completed_batches,
 toString(sumIf(row_count,status='complete')) AS total_rows,
 if(countIf(status='complete')=0,NULL,
  formatDateTime(maxIf(updated_at,status='complete'),'%Y-%m-%dT%H:%i:%S.%fZ')) AS latest_completed_at
FROM (
 SELECT status,row_count,updated_at
 FROM ${quoteHubbleIdentifier(executor.database)}._ingestion_batches FINAL
 LIMIT 500001
)
FORMAT JSON`,
			[],
			5_000
		);
		const row = record(response.data?.[0]);
		// The read-only profile forbids per-query settings. Bound the logical input
		// and fail closed if it outgrows this small manifest reader. HTTP has a 5s
		// deadline; database resource limits remain those of the existing profile.
		if (BigInt(integerString(row.manifest_rows)) > 500_000n)
			throw new Error('Publication readiness manifest exceeds its row budget');
		const completedBatches = integerString(row.completed_batches);
		const totalRows = integerString(row.total_rows);
		const latestCompletedAt = row.latest_completed_at;
		if (
			latestCompletedAt !== null &&
			(typeof latestCompletedAt !== 'string' ||
				!Number.isFinite(Date.parse(latestCompletedAt)))
		) throw new Error('Invalid publication timestamp');
		if (BigInt(completedBatches) > 0n && latestCompletedAt === null)
			throw new Error('Completed publication timestamp unavailable');
		return {
			generatedAt: new Date().toISOString(),
			completedBatches,
			totalRows,
			latestCompletedAt
		};
	}, 45_000);

	const archive = cachedSource(async () => {
		const rows: unknown = await config.manager.transaction(async (manager) => {
			await manager.query('SET TRANSACTION READ ONLY');
			await manager.query(
				`SELECT set_config('statement_timeout',$1::text,true),
 set_config('lock_timeout',$2::text,true)`,
				['2000ms', '250ms']
			);
			return manager.query(archiveReadinessSql);
		});
		if (!Array.isArray(rows) || rows.length !== 1)
			throw new Error('Archive readiness row unavailable');
		const row = record(rows[0]);
		const sourceCount = count(row.known_roots);
		const checkedRoots = count(row.recent_roots);
		const nullTimestamps = count(row.null_timestamp_rows);
		if (checkedRoots > sourceCount)
			throw new Error('Invalid archive readiness counts');
		return {
			generatedAt: new Date().toISOString(),
			sourceCount,
			checkedRoots,
			complete: sourceCount > 0 && nullTimestamps === 0
		};
	}, 10_000);

	return async () => {
		const [catalog, archiveSummary] = await Promise.all([publication(), archive()]);
		return { catalog, archiveSummary };
	};
}

function cachedSource<T>(load: () => Promise<T>, successMs: number) {
	let cached: { readonly value: T | null; readonly until: number } | undefined;
	let inflight: Promise<T | null> | undefined;
	return (): Promise<T | null> => {
		if (cached && cached.until > Date.now()) return Promise.resolve(cached.value);
		if (inflight) return inflight;
		inflight = Promise.resolve().then(load).then(
			(value) => {
				cached = { value, until: Date.now() + successMs };
				return value;
			},
			() => {
				cached = { value: null, until: Date.now() + 5_000 };
				return null;
			}
		).finally(() => { inflight = undefined; });
		return inflight;
	};
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Invalid readiness row');
	return value as Record<string, unknown>;
}

function integerString(value: unknown): string {
	if (typeof value !== 'string' || !/^\d+$/.test(value))
		throw new Error('Invalid publication count');
	return value;
}

function count(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new Error('Invalid archive count');
	return value;
}
