import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScpStatementLiveStore } from './ScpStatementLiveStore.js';
import { settleWithin } from './ScpStatementAsyncDeadline.js';

export type ScpStatementTaskReconciliationAttempt =
	| { error: Error; status: 'failed' }
	| {
			result: Awaited<
				ReturnType<ScpStatementLiveStore['reconcilePendingTask']>
			>;
			status: 'settled';
	  };

export interface BoundedScpStatementTaskReconciliation {
	completion: Promise<ScpStatementTaskReconciliationAttempt>;
	settlement: Promise<ScpStatementTaskReconciliationAttempt | 'timed_out'>;
}

export class ScpStatementProjectionTaskReconciler {
	constructor(
		private readonly liveStore: ScpStatementLiveStore,
		private readonly timeoutMs: number
	) {}

	start(): BoundedScpStatementTaskReconciliation {
		const completion = this.liveStore.reconcilePendingTask().then(
			(result): ScpStatementTaskReconciliationAttempt => ({
				result,
				status: 'settled'
			}),
			(error: unknown): ScpStatementTaskReconciliationAttempt => ({
				error: mapUnknownToError(error),
				status: 'failed'
			})
		);
		return {
			completion,
			settlement: settleWithin(completion, this.timeoutMs)
		};
	}
}
