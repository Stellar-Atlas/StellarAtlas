import type { Result } from 'neverthrow';

export type CrossCheckApiDocsRefreshLockResult<T> =
	| {
			readonly acquired: false;
	  }
	| {
			readonly acquired: true;
			readonly value: T;
	  };

export interface CrossCheckApiDocsRefreshLock {
	runExclusive<T>(
		work: () => Promise<Result<T, Error>>
	): Promise<Result<CrossCheckApiDocsRefreshLockResult<T>, Error>>;
}
