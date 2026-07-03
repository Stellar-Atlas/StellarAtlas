import { err, ok } from 'neverthrow';
import { TypeOrmCrossCheckApiDocsRefreshLock } from '../TypeOrmCrossCheckApiDocsRefreshLock.js';

describe('TypeOrmCrossCheckApiDocsRefreshLock', () => {
	it('should run work while the advisory lock is held and release it', async () => {
		const queryRunner = createQueryRunner([[{ acquired: true }], []]);
		const lock = new TypeOrmCrossCheckApiDocsRefreshLock(
			createDataSource(queryRunner) as never
		);

		const result = await lock.runExclusive(async () => ok('done'));

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({ acquired: true, value: 'done' });
		expect(queryRunner.connect).toHaveBeenCalledTimes(1);
		expect(queryRunner.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('pg_try_advisory_lock'),
			['stellaratlas', 'cross-check-api-docs-refresh']
		);
		expect(queryRunner.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('pg_advisory_unlock'),
			['stellaratlas', 'cross-check-api-docs-refresh']
		);
		expect(queryRunner.release).toHaveBeenCalledTimes(1);
	});

	it('should skip work when another process owns the advisory lock', async () => {
		const queryRunner = createQueryRunner([[{ acquired: false }]]);
		const lock = new TypeOrmCrossCheckApiDocsRefreshLock(
			createDataSource(queryRunner) as never
		);
		const work = jest.fn(async () => ok('done'));

		const result = await lock.runExclusive(work);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({ acquired: false });
		expect(work).not.toHaveBeenCalled();
		expect(queryRunner.release).toHaveBeenCalledTimes(1);
	});

	it('should release the advisory lock when work fails', async () => {
		const queryRunner = createQueryRunner([[{ acquired: true }], []]);
		const lock = new TypeOrmCrossCheckApiDocsRefreshLock(
			createDataSource(queryRunner) as never
		);

		const result = await lock.runExclusive(async () =>
			err(new Error('refresh failed'))
		);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected lock error');
		expect(result.error.message).toBe('refresh failed');
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('pg_advisory_unlock'),
			['stellaratlas', 'cross-check-api-docs-refresh']
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
