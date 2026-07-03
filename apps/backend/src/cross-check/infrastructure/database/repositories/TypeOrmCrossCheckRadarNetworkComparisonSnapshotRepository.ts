import { injectable } from 'inversify';
import type { Repository } from 'typeorm';
import type {
	CrossCheckRadarNetworkComparisonSnapshotListItemDTO,
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	CrossCheckRadarNetworkSnapshotFailureDTO,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '@cross-check/domain/CrossCheckRadarNetworkSnapshot.js';
import type { CrossCheckRadarNetworkComparisonSummaryDTO } from '@cross-check/domain/CrossCheckRadarNetworkComparison.js';
import { CrossCheckRadarNetworkComparisonSnapshot } from '../entities/CrossCheckRadarNetworkComparisonSnapshot.js';

interface RawRadarNetworkSnapshotListItem {
	readonly comparisonSummary: unknown;
	readonly failure: CrossCheckRadarNetworkSnapshotFailureDTO | null;
	readonly generatedAt: Date;
	readonly id: string;
	readonly status: 'compared' | 'failed';
	readonly storedAt: Date;
}

@injectable()
export class TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	constructor(
		private readonly repository: Repository<CrossCheckRadarNetworkComparisonSnapshot>
	) {}

	async save(
		snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		const generatedAt = validateSnapshot(snapshot);
		const entity = this.repository.create({
			comparison: snapshot.comparison,
			failure: snapshot.failure,
			generatedAt,
			status: snapshot.status
		});

		return mapEntity(await this.repository.save(entity));
	}

	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
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
	): Promise<readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]> {
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
			.getRawMany<RawRadarNetworkSnapshotListItem>();

		return rows.map(mapListItem);
	}
}

function validateSnapshot(
	snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
): Date {
	const generatedAt = requireDate(snapshot.generatedAt, 'generatedAt');

	if (snapshot.status === 'compared') {
		requireDate(snapshot.comparison.generatedAt, 'comparison.generatedAt');
		if (snapshot.generatedAt !== snapshot.comparison.generatedAt) {
			throw new Error(
				'RADAR network comparison snapshot generatedAt must match comparison.generatedAt'
			);
		}
		return generatedAt;
	}

	requireDate(snapshot.failure.occurredAt, 'failure.occurredAt');
	if (snapshot.generatedAt !== snapshot.failure.occurredAt) {
		throw new Error(
			'RADAR network failure snapshot generatedAt must match failure.occurredAt'
		);
	}
	return generatedAt;
}

function mapEntity(
	entity: CrossCheckRadarNetworkComparisonSnapshot
): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
	if (entity.status === 'compared') {
		if (entity.comparison === null || entity.failure !== null) {
			throw new Error(
				'RADAR network snapshot row has invalid comparison payload'
			);
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
		throw new Error('RADAR network snapshot row has invalid failure payload');
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
	row: RawRadarNetworkSnapshotListItem
): CrossCheckRadarNetworkComparisonSnapshotListItemDTO {
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
): CrossCheckRadarNetworkComparisonSummaryDTO {
	if (!isComparisonSummary(value)) {
		throw new Error(
			'RADAR network snapshot row has invalid comparison summary'
		);
	}

	return value;
}

function isComparisonSummary(
	value: unknown
): value is CrossCheckRadarNetworkComparisonSummaryDTO {
	if (typeof value !== 'object' || value === null) return false;
	const summary = value as Record<string, unknown>;

	return (
		Number.isInteger(summary.fieldMismatchCount) &&
		Number.isInteger(summary.matchedCount) &&
		Number.isInteger(summary.organizationCount) &&
		Number.isInteger(summary.sourceMissingCount) &&
		Number.isInteger(summary.stellarAtlasMissingCount) &&
		Number.isInteger(summary.totalCount) &&
		Number.isInteger(summary.validatorCount)
	);
}

function requireDate(value: string, field: string): Date {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`RADAR network snapshot is missing valid ${field}`);
	}

	return parsed;
}
