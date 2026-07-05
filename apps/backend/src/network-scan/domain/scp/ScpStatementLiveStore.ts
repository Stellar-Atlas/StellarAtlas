import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationV1 } from 'shared';
import type { ScpStatementObservationFilter } from './ScpStatementObservationRepository.js';

export interface ScpStatementLiveCursor {
	observedAtMs: number;
	statementHash: string;
}

export type ScpStatementLiveOrder = 'asc' | 'desc';

export interface ScpStatementLiveFilter extends ScpStatementObservationFilter {
	after?: ScpStatementLiveCursor;
	order?: ScpStatementLiveOrder;
}

export interface ScpStatementLiveStore {
	findLatest(
		filter: ScpStatementLiveFilter
	): Promise<ScpStatementObservationV1[] | null>;
	saveMany(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<void>;
}
