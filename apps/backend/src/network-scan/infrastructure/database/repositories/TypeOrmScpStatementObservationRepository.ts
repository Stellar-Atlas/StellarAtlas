import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { Repository } from 'typeorm';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import type {
	ScpStatementObservationFilter,
	ScpStatementObservationRepository
} from '@network-scan/domain/scp/ScpStatementObservationRepository.js';

const MAX_SAVED_PER_CRAWL = 5000;

export class TypeOrmScpStatementObservationRepository
	implements ScpStatementObservationRepository
{
	constructor(private repository: Repository<ScpStatementObservation>) {}

	async saveMany(
		observations: CrawlerScpStatementObservation[]
	): Promise<void> {
		if (observations.length === 0) return;

		const entities = observations
			.slice(-MAX_SAVED_PER_CRAWL)
			.map((observation) => new ScpStatementObservation(observation));

		await this.repository.upsert(entities, {
			conflictPaths: ['statementHash'],
			skipUpdateIfNoValuesChanged: true
		});
	}

	async findLatest({
		limit,
		nodeId,
		slotIndex
	}: ScpStatementObservationFilter): Promise<ScpStatementObservation[]> {
		const builder = this.repository
			.createQueryBuilder('observation')
			.orderBy('observation.observedAt', 'DESC')
			.addOrderBy('observation.id', 'DESC')
			.limit(limit);

		if (nodeId !== undefined) {
			builder.andWhere('observation.nodeId = :nodeId', { nodeId });
		}

		if (slotIndex !== undefined) {
			builder.andWhere('observation.slotIndex = :slotIndex', { slotIndex });
		}

		return builder.getMany();
	}
}
