import type { QueryRunner } from 'typeorm';
import { FullHistoryZeroTransactionProofPromotionMigration1785260000000 } from '../1785260000000-FullHistoryZeroTransactionProofPromotionMigration.js';

describe('FullHistoryZeroTransactionProofPromotionMigration1785260000000', () => {
	it('admits proof-v8 category omissions without admitting missing ledger headers', async () => {
		const query = jest.fn(async () => undefined);
		const migration =
			new FullHistoryZeroTransactionProofPromotionMigration1785260000000();

		await migration.up({ query } as unknown as QueryRunner);

		const sql = String(query.mock.calls[0]?.[0]);
		expect(sql).toContain('proof."ledgerFactCount" = new."ledger_count"');
		expect(sql).toMatch(/proof\."proofVersion"\s*>=\s*8/);
		expect(sql).toMatch(
			/proof\."transactionFactCount"\s+between 0\s+and new\."ledger_count"/
		);
		expect(sql).toMatch(
			/proof\."resultFactCount"\s+between 0\s+and new\."ledger_count"/
		);
	});

	it('restores exact category-frame counts on rollback', async () => {
		const query = jest.fn(async () => undefined);
		const migration =
			new FullHistoryZeroTransactionProofPromotionMigration1785260000000();

		await migration.down({ query } as unknown as QueryRunner);

		const sql = String(query.mock.calls[0]?.[0]);
		expect(sql).toContain('proof."transactionFactCount" = new."ledger_count"');
		expect(sql).toContain('proof."resultFactCount" = new."ledger_count"');
		expect(sql).not.toContain('proof."transactionFactCount" between 0');
	});
});
