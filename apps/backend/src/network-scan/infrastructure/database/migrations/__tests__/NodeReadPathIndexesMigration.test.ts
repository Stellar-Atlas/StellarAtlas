import type { QueryRunner } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { NodeReadPathIndexesMigration1784990000000 } from '../1784990000000-NodeReadPathIndexesMigration.js';

describe('NodeReadPathIndexesMigration1784990000000', () => {
	it('builds latest-row indexes without blocking scanner writes', async () => {
		const statements: string[] = [];
		const migration = new NodeReadPathIndexesMigration1784990000000();
		const runner = mock<QueryRunner>();
		runner.query.mockImplementation(async (sql: string) => {
			statements.push(sql);
			return [];
		});

		await migration.up(runner);

		const sql = statements.join('\n');
		expect(migration.transaction).toBe(false);
		expect(sql).toContain('create index concurrently if not exists');
		expect(sql).toContain('idx_node_measurement_latest_by_node');
		expect(sql).toContain('"nodeId", "time" desc');
		expect(sql).toContain('idx_node_snapshot_latest_by_node');
		expect(sql).toContain('"NodeId", "endDate" desc');
	});
});
