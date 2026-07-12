import type { QueryRunner } from 'typeorm';
import { ParsedHistoryObservationMigration1784850000000 } from '../1784850000000-ParsedHistoryObservationMigration.js';

describe('ParsedHistoryObservationMigration1784850000000', () => {
	it('creates only narrow provenance associations without copying XDR', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
			})
		} as unknown as QueryRunner;

		await new ParsedHistoryObservationMigration1784850000000().up(queryRunner);

		const sql = queries.join('\n');
		expect(sql).toContain('parsed_ledger_header_observation');
		expect(sql).toContain('parsed_transaction_envelope_observation');
		expect(sql).toContain('parsed_transaction_result_observation');
		expect(sql).toContain('"sourceObjectRemoteId" text not null');
		expect(sql).toContain('"parsedLedgerHeaderId" integer not null');
		expect(sql).toContain('"closedAt" timestamptz');
		expect(sql).toContain('"parsedTransactionEnvelopeId" integer not null');
		expect(sql).toContain('"parsedTransactionResultId" integer not null');
		expect(sql).toContain("set local lock_timeout = '2s'");
		expect(sql).not.toContain('insert into');
		expect(sql).not.toContain('sourceArchiveUrl');
		expect(sql).not.toContain('history_archive_object_queue');
		expect(sql).not.toContain('ledgerHeaderHash');
		expect(sql).not.toContain('transactionSetHash');
		expect(sql).not.toContain('transactionResultHash');
		expect(sql).not.toContain('Xdr');
		expect(sql).not.toContain('xdr');
	});

	it('drops only the additive observation tables', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
			})
		} as unknown as QueryRunner;

		await new ParsedHistoryObservationMigration1784850000000().down(
			queryRunner
		);

		expect(queries).toHaveLength(4);
		expect(queries[0]).toContain("set local lock_timeout = '2s'");
		expect(
			queries.slice(1).every((sql) => sql.includes('drop table if exists'))
		).toBe(true);
	});
});
