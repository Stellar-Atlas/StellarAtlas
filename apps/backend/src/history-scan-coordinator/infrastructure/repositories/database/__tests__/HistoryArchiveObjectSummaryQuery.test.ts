import { managedMigrations } from '@core/infrastructure/database/ManagedMigrations.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../../../database/migrations/1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import { HistoryArchiveGlobalBucketHashIndexMigration1785090000000 } from '../../../database/migrations/1785090000000-HistoryArchiveGlobalBucketHashIndexMigration.js';
import { HistoryArchiveBucketReferenceSummaryMigration1785100000000 } from '../../../database/migrations/1785100000000-HistoryArchiveBucketReferenceSummaryMigration.js';
import {
	archiveObjectBucketHashIndexName,
	archiveObjectGlobalBucketHashIndexName,
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
	it('keeps the three archive summary migrations in dependency order', () => {
		const typeSummaryIndex = managedMigrations.indexOf(
			HistoryArchiveObjectTypeSummaryMigration1785080000000
		);
		const globalBucketIndex = managedMigrations.indexOf(
			HistoryArchiveGlobalBucketHashIndexMigration1785090000000
		);
		const referenceSummaryIndex = managedMigrations.indexOf(
			HistoryArchiveBucketReferenceSummaryMigration1785100000000
		);

		expect(typeSummaryIndex).toBeGreaterThanOrEqual(0);
		expect(globalBucketIndex).toBeGreaterThan(typeSummaryIndex);
		expect(referenceSummaryIndex).toBeGreaterThan(globalBucketIndex);
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

	it('isolates exact bucket distinctness on compact reference summaries', () => {
		expect(uniqueBucketHashReadSettingsSql).toContain(
			"set_config('statement_timeout'"
		);
		expect(uniqueBucketHashReadSettingsSql).toContain('"complete" = true');
		expect(uniqueBucketHashReadSettingsSql).toContain(
			'history_archive_bucket_reference_summary_progress'
		);
		expect(archiveObjectBucketHashIndexName).toBe(
			'idx_history_archive_object_bucket_hash'
		);
		expect(archiveObjectGlobalBucketHashIndexName).toBe(
			'idx_history_archive_object_bucket_hash_global'
		);
		expect(uniqueBucketHashGlobalSql).toContain(
			'history_archive_bucket_identity_summary'
		);
		expect(uniqueBucketHashArchiveSql).toContain(
			'history_archive_bucket_reference_summary'
		);
		for (const sql of [uniqueBucketHashGlobalSql, uniqueBucketHashArchiveSql])
			expect(sql).not.toContain('history_archive_object_queue');
	});
});
