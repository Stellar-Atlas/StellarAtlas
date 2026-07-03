import type { Result } from 'neverthrow';

export type CrossCheckRefreshLockResult<T> =
	| {
			readonly acquired: false;
	  }
	| {
			readonly acquired: true;
			readonly value: T;
	  };

export interface CrossCheckRefreshLock {
	runExclusive<T>(
		work: () => Promise<Result<T, Error>>
	): Promise<Result<CrossCheckRefreshLockResult<T>, Error>>;
}
