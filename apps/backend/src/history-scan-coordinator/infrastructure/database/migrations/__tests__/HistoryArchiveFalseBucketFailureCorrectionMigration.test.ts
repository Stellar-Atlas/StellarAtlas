import { HistoryArchiveFalseBucketFailureCorrectionMigration1785050000000 } from '../1785050000000-HistoryArchiveFalseBucketFailureCorrectionMigration.js';

describe('HistoryArchiveFalseBucketFailureCorrectionMigration', () => {
	it('only reclassifies aborted bucket failures without verification facts', async () => {
		const queries: string[] = [];
		const migration =
			new HistoryArchiveFalseBucketFailureCorrectionMigration1785050000000();
		await migration.up({
			query: async (sql: string) => {
				queries.push(sql);
			}
		} as never);

		const sql = queries.join('\n');
		expect(sql).toContain('"objectType" = \'bucket\'');
		expect(sql).toContain('"errorType" = \'bucket_verification_failed\'');
		expect(sql).toContain("like '%abort%'");
		expect(sql).toContain('"verificationFacts" is null');
		expect(sql).toContain('set "errorType" = \'archive_transport_error\'');
		expect(sql).toContain('history_archive_object_event');
		expect(sql).toContain('history_archive_object_queue');
	});
});
