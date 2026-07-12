import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from './ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from './ScpStatementObservationRepository.js';

export interface ScpStatementReadModelProjectorOptions {
	backfillBatchSize?: number;
	backfillTimeoutMs?: number;
	backfillWindowMs?: number;
	batchSize?: number;
	cooldownMs?: number;
	maxOutstandingRequests?: number;
	tailBatchSize?: number;
	tailPollIntervalMs?: number;
	tailTimeoutMs?: number;
	taskReconciliationIntervalMs?: number;
	timeoutMs?: number;
}

export interface ProjectionWork {
	backfillNextAfterId?: number | null;
	observations: CrawlerScpStatementObservation[];
}

export type ProjectionRequestOutcome =
	| { status: 'failed'; error: Error }
	| {
			result: Awaited<ReturnType<ScpStatementLiveStore['saveMany']>>;
			status: 'settled';
	  };

export type BackfillRequestOutcome =
	| { error: Error; status: 'failed' }
	| {
			page: Awaited<
				ReturnType<ScpStatementObservationRepository['findProjectionPage']>
			>;
			status: 'settled';
	  };

export interface ProjectionDrainWaiter {
	resolve: (drained: boolean) => void;
	timeout: ReturnType<typeof setTimeout>;
}
