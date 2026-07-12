import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationV1 } from 'shared';
import type {
	ScpStatementObservationFilter,
	ScpStatementReadCursor,
	ScpStatementReadOrder
} from './ScpStatementObservationRepository.js';

export type ScpStatementLiveCursor = ScpStatementReadCursor;
export type ScpStatementLiveOrder = ScpStatementReadOrder;

export type ScpStatementProjectionOutcome =
	| { status: 'accepted'; taskPending?: boolean }
	| {
			reason: string;
			retryAfterMs?: number;
			status: 'deferred';
	  };

export type ScpStatementProjectionTaskOutcome =
	| { status: 'settled' }
	| { retryAfterMs: number; status: 'pending' }
	| { reason: string; retryAfterMs?: number; status: 'failed' };

export interface ScpStatementLiveFilter extends ScpStatementObservationFilter {
	after?: ScpStatementLiveCursor;
	order?: ScpStatementLiveOrder;
}

export interface ScpStatementLiveStore {
	findLatest(
		filter: ScpStatementLiveFilter
	): Promise<ScpStatementObservationV1[] | null>;
	reconcilePendingTask(): Promise<ScpStatementProjectionTaskOutcome>;
	saveMany(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<ScpStatementProjectionOutcome>;
}
