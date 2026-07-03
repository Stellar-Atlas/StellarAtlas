import { injectable } from 'inversify';
import type { Repository } from 'typeorm';
import type {
	CrossCheckApiDocsComparisonSnapshotListItemDTO,
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	CrossCheckApiDocsSnapshotFailureDTO,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '@cross-check/domain/CrossCheckApiDocsSnapshot.js';
import type { CrossCheckApiDocsComparisonSummaryDTO } from '@cross-check/domain/CrossCheckApiDocsComparison.js';
import { CrossCheckApiDocsComparisonSnapshot } from '../entities/CrossCheckApiDocsComparisonSnapshot.js';

interface RawApiDocsSnapshotListItem {
	readonly comparisonSummary: unknown;
	readonly failure: CrossCheckApiDocsSnapshotFailureDTO | null;
	readonly generatedAt: Date;
	readonly id: string;
	readonly status: 'compared' | 'failed';
	readonly storedAt: Date;
}

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

	async findRecent(
		limit: number
	): Promise<readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]> {
		const rows = await this.repository
			.createQueryBuilder('snapshot')
			.select('snapshot.id', 'id')
			.addSelect('snapshot.status', 'status')
			.addSelect('snapshot.generatedAt', 'generatedAt')
			.addSelect('snapshot.storedAt', 'storedAt')
			.addSelect("snapshot.comparison -> 'summary'", 'comparisonSummary')
			.addSelect('snapshot.failure', 'failure')
			.orderBy('snapshot.generatedAt', 'DESC')
			.addOrderBy('snapshot.storedAt', 'DESC')
			.addOrderBy('snapshot.id', 'DESC')
			.limit(limit)
			.getRawMany<RawApiDocsSnapshotListItem>();

		return rows.map(mapListItem);
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

function mapListItem(
	row: RawApiDocsSnapshotListItem
): CrossCheckApiDocsComparisonSnapshotListItemDTO {
	if (row.status === 'compared') {
		return {
			comparisonSummary: requireComparisonSummary(row.comparisonSummary),
			failure: null,
			generatedAt: row.generatedAt.toISOString(),
			id: row.id,
			status: row.status,
			storedAt: row.storedAt.toISOString()
		};
	}

	return {
		comparisonSummary: null,
		failure: row.failure,
		generatedAt: row.generatedAt.toISOString(),
		id: row.id,
		status: row.status,
		storedAt: row.storedAt.toISOString()
	};
}

function requireComparisonSummary(
	value: unknown
): CrossCheckApiDocsComparisonSummaryDTO {
	if (!isComparisonSummary(value)) {
		throw new Error('API docs snapshot row has invalid comparison summary');
	}

	return value;
}

function isComparisonSummary(
	value: unknown
): value is CrossCheckApiDocsComparisonSummaryDTO {
	if (typeof value !== 'object' || value === null) return false;
	const summary = value as Record<string, unknown>;

	return (
		Number.isInteger(summary.fieldMismatchCount) &&
		Number.isInteger(summary.matchedCount) &&
		Number.isInteger(summary.sourceMissingCount) &&
		Number.isInteger(summary.stellarAtlasMissingCount) &&
		Number.isInteger(summary.totalCount)
	);
}

function requireDate(value: string, field: string): Date {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`API docs snapshot is missing valid ${field}`);
	}

	return parsed;
}
