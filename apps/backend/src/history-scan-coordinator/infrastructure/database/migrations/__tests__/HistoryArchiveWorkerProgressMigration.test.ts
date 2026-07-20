import type { QueryRunner } from 'typeorm';
import { HistoryArchiveWorkerProgressMigration1785210000000 } from '../1785210000000-HistoryArchiveWorkerProgressMigration.js';

describe('HistoryArchiveWorkerProgressMigration', () => {
	it('adds a bounded logical slot and optional transfer total', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
			})
		} as unknown as QueryRunner;

		await new HistoryArchiveWorkerProgressMigration1785210000000().up(
			queryRunner
		);

		const sql = queries.join('\n');
		expect(sql).toContain('"slotIndex" smallint');
		expect(sql).toContain('"bytesTotal" bigint');
		expect(sql).toContain('"slotIndex" between 0 and 23');
		expect(sql).toContain('"bytesTotal" is null or "bytesTotal" >= 0');
		expect(sql).toContain('substring("workerId" from \'-([0-9]+)-[0-9]+$\')');
	});
});
