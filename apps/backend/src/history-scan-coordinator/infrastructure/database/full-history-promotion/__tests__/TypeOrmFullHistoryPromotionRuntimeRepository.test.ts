import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { TypeOrmFullHistoryPromotionRuntimeRepository } from '../TypeOrmFullHistoryPromotionRuntimeRepository.js';

describe('full-history promotion dependency heartbeat', () => {
	it('updates liveness only while retaining blocker and progress evidence', async () => {
		const source = mock<DataSource>();
		source.query.mockResolvedValue([{ updated: 1 }]);
		const repository = new TypeOrmFullHistoryPromotionRuntimeRepository(source);
		await repository.heartbeat('test', '00000000-0000-4000-8000-000000000001');
		const [sql, parameters] = source.query.mock.calls[0]!;
		expect(sql).toContain('set "heartbeat_at" = now(), "updated_at" = now()');
		expect(sql).toContain('and "instance_id" = $2');
		for (const evidence of [
			'state =',
			'last_error_code',
			'last_failure_at',
			'last_attempt_at',
			'last_success_at',
			'checkpoint_ledger',
			'next_ledger'
		]) {
			expect(sql).not.toContain(evidence);
		}
		expect(parameters).toHaveLength(2);
	});

	it('refuses heartbeat from an instance which no longer owns runtime', async () => {
		const source = mock<DataSource>();
		source.query.mockResolvedValue([{ updated: 0 }]);
		await expect(
			new TypeOrmFullHistoryPromotionRuntimeRepository(source).heartbeat(
				'test',
				'00000000-0000-4000-8000-000000000001'
			)
		).rejects.toThrow('no longer owns runtime state');
	});
});
