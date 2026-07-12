import type { QueryRunner } from 'typeorm';
import { HistoryArchiveWorkerStatusMigration1784790000000 } from '../1784790000000-HistoryArchiveWorkerStatusMigration.js';

describe('HistoryArchiveWorkerStatusMigration', () => {
	it('creates compact constrained status columns without log or evidence payloads', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
			})
		} as unknown as QueryRunner;

		await new HistoryArchiveWorkerStatusMigration1784790000000().up(
			queryRunner
		);

		const sql = queries.join('\n');
		expect(sql).toContain('"objectTypeCode" smallint');
		expect(sql).toContain('"stageCode" smallint not null');
		expect(sql).toContain('"bytesDownloaded" bigint');
		expect(sql).toContain('"lastOutcomeCode" smallint not null');
		expect(sql).toContain('"processGeneration" integer not null');
		expect(sql).toContain('"sequence" bigint not null');
		expect(sql).toContain('unique ("workerId")');
		expect(sql).not.toContain('errorMessage');
		expect(sql).not.toContain('verificationFacts');
		expect(sql).not.toContain('jsonb');
	});
});
