import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import {
	archiveObjectTypeSummaryBatchBoundarySql,
	archiveObjectTypeSummaryBatchSize,
	archiveObjectTypeSummaryBatchSql,
	archiveObjectTypeSummaryGlobalExclusiveLockSql,
	archiveObjectTypeSummaryTriggerFunctionSql,
	archiveObjectTypeSummaryTruncateFunctionSql
} from '../../../repositories/database/HistoryArchiveObjectTypeSummarySql.js';

describe('HistoryArchiveObjectTypeSummaryMigration1785080000000', () => {
	it('is an additive non-transactional migration with a bounded keyset backfill', () => {
		const migration =
			new HistoryArchiveObjectTypeSummaryMigration1785080000000();

		expect(migration.name).toBe(
			'HistoryArchiveObjectTypeSummaryMigration1785080000000'
		);
		expect(migration.transaction).toBe(false);
		expect(archiveObjectTypeSummaryBatchSize).toBe(100_000);
		expect(archiveObjectTypeSummaryBatchBoundarySql).toContain(
			'id > $1::bigint'
		);
		expect(archiveObjectTypeSummaryBatchBoundarySql).toContain(
			'id <= $2::bigint'
		);
		expect(archiveObjectTypeSummaryBatchBoundarySql).toContain(
			'limit $3::integer'
		);
		expect(
			archiveObjectTypeSummaryBatchBoundarySql.toLowerCase()
		).not.toContain('offset');
	});

	it('groups every requested counter by archive root and object type', () => {
		expect(archiveObjectTypeSummaryBatchSql).toContain(
			'group by "archiveUrlIdentity", "objectType"'
		);
		expect(archiveObjectTypeSummaryBatchSql).toContain(`status = 'pending'`);
		expect(archiveObjectTypeSummaryBatchSql).toContain(`status = 'scanning'`);
		expect(archiveObjectTypeSummaryBatchSql).toContain(`status = 'verified'`);
		expect(archiveObjectTypeSummaryBatchSql).toContain(
			`"failureChannel" = 'archive_evidence'`
		);
		expect(archiveObjectTypeSummaryBatchSql).toContain(
			`"failureChannel" = 'scanner_issue'`
		);
		expect(archiveObjectTypeSummaryBatchSql).toContain(
			'on conflict ("archiveUrlIdentity", "objectType")'
		);
	});

	it('serializes trigger deltas with batches and tracks both sides of updates', () => {
		expect(archiveObjectTypeSummaryGlobalExclusiveLockSql).toContain(
			'pg_advisory_xact_lock(1785080000, 0)'
		);
		expect(archiveObjectTypeSummaryTriggerFunctionSql).toContain(
			'pg_advisory_xact_lock_shared(1785080000, 0)'
		);
		expect(archiveObjectTypeSummaryTriggerFunctionSql).toContain(
			`old."archiveUrlIdentity" || chr(31) || old."objectType"`
		);
		expect(archiveObjectTypeSummaryTriggerFunctionSql).toContain(
			`new."archiveUrlIdentity" || chr(31) || new."objectType"`
		);
		expect(archiveObjectTypeSummaryTriggerFunctionSql).toContain(
			'old.id <= last_object_id'
		);
		expect(archiveObjectTypeSummaryTriggerFunctionSql).toContain(
			'new.id > cutoff_object_id'
		);
		expect(archiveObjectTypeSummaryTruncateFunctionSql).toContain(
			'"complete" = true'
		);
		expect(archiveObjectTypeSummaryTruncateFunctionSql).toContain(
			'"completedAt" = now()'
		);
	});
});
