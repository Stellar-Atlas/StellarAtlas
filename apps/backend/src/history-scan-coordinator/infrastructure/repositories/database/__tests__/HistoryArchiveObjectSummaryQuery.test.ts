import { managedMigrations } from '@core/infrastructure/database/ManagedMigrations.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../../../database/migrations/1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import {
	archiveObjectBucketHashIndexName,
	uniqueBucketHashArchiveSql,
	uniqueBucketHashGlobalSql,
	uniqueBucketHashReadSettingsSql
} from '../HistoryArchiveObjectBucketSummaryQuery.js';
import { sourceSummarySql } from '../HistoryArchiveObjectSourceSummaryQuery.js';
import {
	objectTypeSummaryReadinessSql,
	objectTypeSummarySql
} from '../HistoryArchiveObjectTypeSummaryReadQuery.js';

describe('HistoryArchiveObjectSummaryQuery SQL', () => {
	it('registers the type-summary migration after the prior managed migration', () => {
		expect(managedMigrations.at(-1)).toBe(
			HistoryArchiveObjectTypeSummaryMigration1785080000000
		);
	});

	it('requires all three rollup completion signals', () => {
		expect(objectTypeSummaryReadinessSql).toContain('"complete" = true');
		expect(objectTypeSummaryReadinessSql).toContain(
			'"completedAt" is not null'
		);
		expect(objectTypeSummaryReadinessSql).toContain(
			'"lastObjectId" = "cutoffObjectId"'
		);
	});

	it('reads type and source counts only from the compact rollup', () => {
		for (const sql of [objectTypeSummarySql, sourceSummarySql]) {
			expect(sql).toContain('history_archive_object_type_summary');
			expect(sql).not.toContain('history_archive_object_queue');
		}
		expect(sourceSummarySql).toContain(
			'"totalObjects" - "pendingObjects" - "scanningObjects"'
		);
	});

	it('isolates exact bucket distinctness on the required partial index', () => {
		expect(uniqueBucketHashReadSettingsSql).toContain(
			"set_config('statement_timeout'"
		);
		expect(uniqueBucketHashReadSettingsSql).toContain(
			"set_config('enable_seqscan', 'off'"
		);
		expect(uniqueBucketHashReadSettingsSql).toContain(
			"set_config('enable_bitmapscan', 'off'"
		);
		expect(uniqueBucketHashReadSettingsSql).toContain('indisvalid');
		expect(uniqueBucketHashReadSettingsSql).toContain('indisready');
		expect(archiveObjectBucketHashIndexName).toBe(
			'idx_history_archive_object_bucket_hash'
		);
		for (const sql of [uniqueBucketHashGlobalSql, uniqueBucketHashArchiveSql]) {
			expect(sql).toContain('count(distinct "bucketHash")');
			expect(sql).toContain('"objectType" = \'bucket\'');
			expect(sql).toContain('"bucketHash" is not null');
		}
	});
});
