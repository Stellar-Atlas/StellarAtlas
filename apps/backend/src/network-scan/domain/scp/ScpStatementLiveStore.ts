import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationV1 } from 'shared';
import type { ScpStatementObservationFilter } from './ScpStatementObservationRepository.js';

export interface ScpStatementLiveStore {
	findLatest(
		filter: ScpStatementObservationFilter
	): Promise<ScpStatementObservationV1[] | null>;
	saveMany(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<void>;
}
