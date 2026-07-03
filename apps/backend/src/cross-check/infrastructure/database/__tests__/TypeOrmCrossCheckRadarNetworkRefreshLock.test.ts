import { ok } from 'neverthrow';
import { TypeOrmCrossCheckRadarNetworkRefreshLock } from '../TypeOrmCrossCheckRadarNetworkRefreshLock.js';

describe('TypeOrmCrossCheckRadarNetworkRefreshLock', () => {
	it('should use a distinct advisory lock name', async () => {
		const queryRunner = createQueryRunner([[{ acquired: true }], []]);
		const lock = new TypeOrmCrossCheckRadarNetworkRefreshLock(
			createDataSource(queryRunner) as never
		);

		const result = await lock.runExclusive(async () => ok('done'));

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({ acquired: true, value: 'done' });
		expect(queryRunner.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('pg_try_advisory_lock'),
			['stellaratlas', 'cross-check-radar-network-refresh']
		);
		expect(queryRunner.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('pg_advisory_unlock'),
			['stellaratlas', 'cross-check-radar-network-refresh']
		);
		expect(queryRunner.release).toHaveBeenCalledTimes(1);
	});
});

function createDataSource(queryRunner: unknown): unknown {
	return {
		createQueryRunner: jest.fn(() => queryRunner)
	};
}

function createQueryRunner(results: unknown[]): {
	readonly connect: jest.Mock;
	readonly query: jest.Mock;
	readonly release: jest.Mock;
} {
	return {
		connect: jest.fn(async () => undefined),
		query: jest.fn(async () => {
			const result = results.shift();
			return result;
		}),
		release: jest.fn(async () => undefined)
	};
}
