import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveBucketCoverageV1,
	HistoryArchiveObjectTypeSummaryV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type BucketHashIndexRow = {
	readonly bucketHashIndex?: string | null;
	readonly buckethashindex?: string | null;
	readonly bucketHashIndexReady?: boolean;
	readonly buckethashindexready?: boolean;
};

type UniqueBucketHashRow = {
	readonly uniqueBucketHashes?: NumericValue;
	readonly uniquebuckethashes?: NumericValue;
};

export const archiveObjectBucketHashIndexName =
	'idx_history_archive_object_bucket_hash';
export const archiveObjectUniqueBucketHashStatementTimeoutMs = 10_000;

export class HistoryArchiveUniqueBucketHashSummaryUnavailableError extends Error {
	constructor(cause?: unknown) {
		super(
			'Exact archive bucket hash summary is unavailable',
			cause === undefined ? undefined : { cause }
		);
		this.name = 'HistoryArchiveUniqueBucketHashSummaryUnavailableError';
	}
}

export function buildBucketCoverage(
	objectTypes: readonly HistoryArchiveObjectTypeSummaryV1[],
	uniqueBucketHashes: number
): HistoryArchiveBucketCoverageV1 {
	const buckets = objectTypes.find((entry) => entry.objectType === 'bucket');
	const totalBucketObjects = buckets?.totalObjects ?? 0;
	if (uniqueBucketHashes < 0 || uniqueBucketHashes > totalBucketObjects) {
		throw new Error(
			'Archive bucket summary has inconsistent unique hash count'
		);
	}

	return {
		activeBucketObjects: buckets?.activeObjects ?? 0,
		failedBucketObjects: buckets?.failedObjects ?? 0,
		pendingBucketObjects: buckets?.pendingObjects ?? 0,
		totalBucketObjects,
		uniqueBucketHashes,
		verifiedBucketObjects: buckets?.verifiedObjects ?? 0
	};
}

export async function getExactUniqueBucketHashCount(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<number> {
	try {
		return await manager.transaction(async (transactionManager) => {
			const [indexRow] = (await transactionManager.query(
				uniqueBucketHashReadSettingsSql,
				[
					archiveObjectBucketHashIndexName,
					`${archiveObjectUniqueBucketHashStatementTimeoutMs}ms`
				]
			)) as readonly BucketHashIndexRow[];
			if (
				(indexRow?.bucketHashIndex ?? indexRow?.buckethashindex) !==
					archiveObjectBucketHashIndexName ||
				(indexRow?.bucketHashIndexReady ?? indexRow?.buckethashindexready) !==
					true
			) {
				throw new HistoryArchiveUniqueBucketHashSummaryUnavailableError();
			}

			const rows = (await transactionManager.query(
				archiveUrlIdentity === null
					? uniqueBucketHashGlobalSql
					: uniqueBucketHashArchiveSql,
				archiveUrlIdentity === null ? [] : [archiveUrlIdentity]
			)) as readonly UniqueBucketHashRow[];
			const row = rows[0];
			return requireNumber(
				row?.uniqueBucketHashes ?? row?.uniquebuckethashes,
				'uniqueBucketHashes'
			);
		});
	} catch (error) {
		if (
			error instanceof HistoryArchiveUniqueBucketHashSummaryUnavailableError
		) {
			throw error;
		}
		throw new HistoryArchiveUniqueBucketHashSummaryUnavailableError(error);
	}
}

// Cross-archive hash distinctness is not derivable from the type rollup. Keep
// this exact read on the covering partial index and cap its wall-clock work.
export const uniqueBucketHashReadSettingsSql = `
	select
		to_regclass($1::text)::text as "bucketHashIndex",
		coalesce((
			select index_metadata.indisvalid and index_metadata.indisready
			from pg_index index_metadata
			where index_metadata.indexrelid = to_regclass($1::text)
				and index_metadata.indrelid =
					to_regclass('history_archive_object_queue')
		), false) as "bucketHashIndexReady",
		set_config('statement_timeout', $2::text, true),
		set_config('enable_seqscan', 'off', true),
		set_config('enable_bitmapscan', 'off', true),
		set_config('jit', 'off', true)
`;

export const uniqueBucketHashGlobalSql = `
	select count(distinct "bucketHash") as "uniqueBucketHashes"
	from history_archive_object_queue
	where "objectType" = 'bucket'
		and "bucketHash" is not null
`;

export const uniqueBucketHashArchiveSql = `
	select count(distinct "bucketHash") as "uniqueBucketHashes"
	from history_archive_object_queue
	where "archiveUrlIdentity" = $1::text
		and "objectType" = 'bucket'
		and "bucketHash" is not null
`;
