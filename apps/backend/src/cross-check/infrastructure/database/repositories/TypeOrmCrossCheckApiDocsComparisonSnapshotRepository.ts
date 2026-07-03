import { injectable } from 'inversify';
import type { Repository } from 'typeorm';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '@cross-check/domain/CrossCheckApiDocsSnapshot.js';
import { CrossCheckApiDocsComparisonSnapshot } from '../entities/CrossCheckApiDocsComparisonSnapshot.js';

@injectable()
export class TypeOrmCrossCheckApiDocsComparisonSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	constructor(
		private readonly repository: Repository<CrossCheckApiDocsComparisonSnapshot>
	) {}

	async save(
		snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		const generatedAt = validateSnapshot(snapshot);
		const entity = this.repository.create({
			comparison: snapshot.comparison,
			failure: snapshot.failure,
			generatedAt,
			status: snapshot.status
		});

		return mapEntity(await this.repository.save(entity));
	}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		const entity = await this.repository
			.createQueryBuilder('snapshot')
			.orderBy('snapshot.generatedAt', 'DESC')
			.addOrderBy('snapshot.storedAt', 'DESC')
			.addOrderBy('snapshot.id', 'DESC')
			.limit(1)
			.getOne();

		return entity === null ? null : mapEntity(entity);
	}
}

function validateSnapshot(
	snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
): Date {
	const generatedAt = requireDate(snapshot.generatedAt, 'generatedAt');

	if (snapshot.status === 'compared') {
		requireDate(snapshot.comparison.generatedAt, 'comparison.generatedAt');
		if (snapshot.generatedAt !== snapshot.comparison.generatedAt) {
			throw new Error(
				'API docs comparison snapshot generatedAt must match comparison.generatedAt'
			);
		}
		return generatedAt;
	}

	requireDate(snapshot.failure.occurredAt, 'failure.occurredAt');
	if (snapshot.generatedAt !== snapshot.failure.occurredAt) {
		throw new Error(
			'API docs failure snapshot generatedAt must match failure.occurredAt'
		);
	}
	return generatedAt;
}

function mapEntity(
	entity: CrossCheckApiDocsComparisonSnapshot
): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	if (entity.status === 'compared') {
		if (entity.comparison === null || entity.failure !== null) {
			throw new Error('API docs snapshot row has invalid comparison payload');
		}

		return {
			comparison: entity.comparison,
			failure: null,
			generatedAt: entity.generatedAt.toISOString(),
			id: entity.id,
			status: entity.status,
			storedAt: entity.storedAt.toISOString()
		};
	}

	if (entity.failure === null || entity.comparison !== null) {
		throw new Error('API docs snapshot row has invalid failure payload');
	}

	return {
		comparison: null,
		failure: entity.failure,
		generatedAt: entity.generatedAt.toISOString(),
		id: entity.id,
		status: entity.status,
		storedAt: entity.storedAt.toISOString()
	};
}

function requireDate(value: string, field: string): Date {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`API docs snapshot is missing valid ${field}`);
	}

	return parsed;
}
