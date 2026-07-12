import type { QueryRunner } from 'typeorm';
import { FullHistoryTransactionBoundMigration1784900000000 } from '../1784900000000-FullHistoryTransactionBoundMigration.js';

describe('FullHistoryTransactionBoundMigration1784900000000', () => {
	it('raises the bounded checkpoint count and validates the constraint', async () => {
		const query = jest.fn(async () => undefined);
		const migration = new FullHistoryTransactionBoundMigration1784900000000();

		await migration.up({ query } as unknown as QueryRunner);

		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0]?.[0]).toContain(
			'"transaction_count" between 0 and 100000'
		);
		expect(query.mock.calls[1]?.[0]).toContain('validate constraint');
	});

	it('restores the previous bound on rollback', async () => {
		const query = jest.fn(async () => undefined);
		const migration = new FullHistoryTransactionBoundMigration1784900000000();

		await migration.down({ query } as unknown as QueryRunner);

		expect(query.mock.calls[0]?.[0]).toContain(
			'"transaction_count" between 0 and 10000'
		);
	});
});
