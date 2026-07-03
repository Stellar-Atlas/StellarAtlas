import { CrossCheckApiDocsComparisonSnapshotMigration1783600000000 } from '../1783600000000-CrossCheckApiDocsComparisonSnapshotMigration.js';

describe('CrossCheckApiDocsComparisonSnapshotMigration1783600000000', () => {
	let migration: CrossCheckApiDocsComparisonSnapshotMigration1783600000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new CrossCheckApiDocsComparisonSnapshotMigration1783600000000();
		queryRunner = { query: jest.fn() };
	});

	it('should create the API docs snapshot table and indexes', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'CREATE TABLE IF NOT EXISTS "cross_check_api_docs_comparison_snapshots"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"id" uuid NOT NULL DEFAULT gen_random_uuid()')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"status" varchar(32) NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"generated_at" TIMESTAMP WITH TIME ZONE NOT NULL'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"comparison" jsonb')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"failure" jsonb')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"stored_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"CHK_cross_check_api_docs_snapshots_status"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"CHK_cross_check_api_docs_snapshots_payload"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_cross_check_api_docs_snapshots_latest"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_api_docs_snapshots_status_generated_at"'
			)
		);
	});

	it('should drop the API docs snapshot table and indexes', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_api_docs_snapshots_status_generated_at"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_cross_check_api_docs_snapshots_latest"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'DROP TABLE IF EXISTS "cross_check_api_docs_comparison_snapshots"'
			)
		);
	});
});
