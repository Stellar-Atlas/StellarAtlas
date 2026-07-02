import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservation } from './ScpStatementObservation.js';

export interface ScpStatementObservationFilter {
	limit: number;
	nodeId?: string;
	slotIndex?: string;
}

export interface ScpStatementObservationRepository {
	saveMany(
		observations: CrawlerScpStatementObservation[]
	): Promise<void>;
	findLatest(
		filter: ScpStatementObservationFilter
	): Promise<ScpStatementObservation[]>;
}
