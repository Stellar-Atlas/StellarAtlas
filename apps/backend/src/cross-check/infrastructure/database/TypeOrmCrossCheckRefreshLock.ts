import { err, ok, Result } from 'neverthrow';
import { DataSource } from 'typeorm';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	CrossCheckRefreshLock,
	CrossCheckRefreshLockResult
} from '@cross-check/domain/CrossCheckRefreshLock.js';

const lockNamespace = 'stellaratlas';

type LockRow = {
	readonly acquired?: boolean;
};

export class TypeOrmCrossCheckRefreshLock implements CrossCheckRefreshLock {
	constructor(
		private readonly dataSource: DataSource,
		private readonly lockName: string
	) {}

	async runExclusive<T>(
		work: () => Promise<Result<T, Error>>
	): Promise<Result<CrossCheckRefreshLockResult<T>, Error>> {
		const queryRunner = this.dataSource.createQueryRunner();

		try {
			await queryRunner.connect();
			const rows = (await queryRunner.query(
				`
				select pg_try_advisory_lock(hashtext($1), hashtext($2)) as "acquired"
				`,
				[lockNamespace, this.lockName]
			)) as LockRow[];
			if (rows[0]?.acquired !== true) return ok({ acquired: false });

			try {
				const result = await work();
				if (result.isErr()) return err(result.error);
				return ok({ acquired: true, value: result.value });
			} finally {
				await queryRunner.query(
					`
					select pg_advisory_unlock(hashtext($1), hashtext($2))
					`,
					[lockNamespace, this.lockName]
				);
			}
		} catch (error) {
			return err(mapUnknownToError(error));
		} finally {
			await queryRunner.release();
		}
	}
}
