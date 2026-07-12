import type { DataSource, QueryRunner } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { acquireFullHistoryOperationBackfillLeadership } from '../FullHistoryOperationBackfillLeadership.js';

describe('FullHistoryOperationBackfillLeadership', () => {
	it('holds one session advisory lock and releases it on the owning connection', async () => {
		const fixture = createFixture(true);
		const lease = await acquireFullHistoryOperationBackfillLeadership(
			fixture.dataSource
		);

		expect(lease.acquired).toBe(true);
		expect(fixture.queryRunner.connect).toHaveBeenCalledTimes(1);
		expect(fixture.queryRunner.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('pg_try_advisory_lock'),
			[1_784_970_000, 1]
		);
		expect(fixture.queryRunner.release).not.toHaveBeenCalled();

		await lease.release();
		await lease.release();
		expect(fixture.queryRunner.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('pg_advisory_unlock'),
			[1_784_970_000, 1]
		);
		expect(fixture.queryRunner.release).toHaveBeenCalledTimes(1);
	});

	it('releases the connection without unlocking when leadership is unavailable', async () => {
		const fixture = createFixture(false);
		const lease = await acquireFullHistoryOperationBackfillLeadership(
			fixture.dataSource
		);

		expect(lease.acquired).toBe(false);
		await lease.release();
		expect(fixture.queryRunner.query).toHaveBeenCalledTimes(1);
		expect(fixture.queryRunner.release).toHaveBeenCalledTimes(1);
	});
});

function createFixture(acquired: boolean): {
	readonly dataSource: DataSource;
	readonly queryRunner: QueryRunner;
} {
	const queryRunner = mock<QueryRunner>();
	queryRunner.connect.mockResolvedValue();
	queryRunner.release.mockResolvedValue();
	queryRunner.query.mockResolvedValueOnce([{ acquired }]);
	queryRunner.query.mockResolvedValueOnce([]);
	const dataSource = mock<DataSource>();
	dataSource.createQueryRunner.mockReturnValue(queryRunner);
	return { dataSource, queryRunner };
}
