import type { QueryRunner } from 'typeorm';
import { FullHistoryProofTimestampPrecisionMigration1784910000000 } from '../1784910000000-FullHistoryProofTimestampPrecisionMigration.js';

describe('FullHistoryProofTimestampPrecisionMigration1784910000000', () => {
	it('compares proof timestamps at JavaScript Date precision', async () => {
		const query = jest.fn(async () => undefined);
		const migration =
			new FullHistoryProofTimestampPrecisionMigration1784910000000();

		await migration.up({ query } as unknown as QueryRunner);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain(
			'date_trunc(\'milliseconds\', proof."evaluatedAt")'
		);
		expect(query.mock.calls[0]?.[0]).toContain('new.\"proof_evaluated_at\"');
	});

	it('restores the exact timestamp predicate on rollback', async () => {
		const query = jest.fn(async () => undefined);
		const migration =
			new FullHistoryProofTimestampPrecisionMigration1784910000000();

		await migration.down({ query } as unknown as QueryRunner);

		expect(query.mock.calls[0]?.[0]).toContain(
			'proof."evaluatedAt" = new."proof_evaluated_at"'
		);
	});
});
