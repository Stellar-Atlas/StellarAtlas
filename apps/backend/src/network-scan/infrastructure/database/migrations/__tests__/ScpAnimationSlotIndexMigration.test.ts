import type { QueryRunner } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { ScpAnimationSlotIndexMigration1784980000000 } from '../1784980000000-ScpAnimationSlotIndexMigration.js';

describe('ScpAnimationSlotIndexMigration1784980000000', () => {
	it('builds the slot playback index without blocking collector writes', async () => {
		const statements: string[] = [];
		const migration = new ScpAnimationSlotIndexMigration1784980000000();
		const runner = mock<QueryRunner>();
		runner.query.mockImplementation(async (sql: string) => {
			statements.push(sql);
			return [];
		});

		await migration.up(runner);

		const sql = statements.join('\n');
		expect(migration.transaction).toBe(false);
		expect(sql).toContain('create index concurrently if not exists');
		expect(sql).toContain('idx_scp_statement_animation_slot');
		expect(sql).toContain('"slotIndex" desc');
		expect(sql).toContain('"observedAt" asc');
	});
});
