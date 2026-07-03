import type {
	CrossCheckApiDocsComparisonSnapshotListItemDTO,
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '../../../domain/CrossCheckApiDocsSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '../ListApiDocsComparisonSnapshots.js';

describe('ListApiDocsComparisonSnapshots', () => {
	it('should return recent persisted API docs comparison snapshot summaries', async () => {
		const snapshots = [
			createComparedSnapshot('snapshot-2', '2026-07-03T12:05:00.000Z', 2),
			createFailedSnapshot()
		];
		const repository = new FakeSnapshotRepository(snapshots);
		const useCase = new ListApiDocsComparisonSnapshots(repository);

		const result = await useCase.execute({ limit: 2 });

		expect(repository.lastLimit).toBe(2);
		const response = result._unsafeUnwrap();
		expect(response).toMatchObject({
			count: 2,
			limit: 2,
			snapshots: [
				{
					comparisonSummary: {
						fieldMismatchCount: 0,
						matchedCount: 2,
						sourceMissingCount: 0,
						stellarAtlasMissingCount: 0,
						totalCount: 2
					},
					failure: null,
					id: 'snapshot-2',
					status: 'compared'
				},
				{
					comparisonSummary: null,
					failure: {
						phase: 'radar_fetch',
						sourceId: 'withobsrvr-radar'
					},
					id: 'snapshot-failed-1',
					status: 'failed'
				}
			]
		});
		expect(response.snapshots[0]).not.toHaveProperty('comparison');
		expect(response.snapshots[0]).not.toHaveProperty('operations');
	});

	it('should use the default limit when no limit is supplied', async () => {
		const repository = new FakeSnapshotRepository([]);
		const useCase = new ListApiDocsComparisonSnapshots(repository);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap().limit).toBe(10);
		expect(repository.lastLimit).toBe(10);
	});

	it('should cap the limit at the maximum', async () => {
		const repository = new FakeSnapshotRepository([]);
		const useCase = new ListApiDocsComparisonSnapshots(repository);

		const result = await useCase.execute({ limit: 100 });

		expect(result._unsafeUnwrap().limit).toBe(25);
		expect(repository.lastLimit).toBe(25);
	});

	it('should return repository read failures as errors', async () => {
		const useCase = new ListApiDocsComparisonSnapshots(
			new FailingSnapshotRepository()
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrapErr().message).toBe('read failed');
	});
});

class FakeSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	lastLimit: number | null = null;

	constructor(
		private readonly snapshots: readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]
	) {}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		throw new Error('not used');
	}

	async findRecent(
		limit: number
	): Promise<readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]> {
		this.lastLimit = limit;
		return this.snapshots.slice(0, limit);
	}

	async save(
		_snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

class FailingSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		throw new Error('not used');
	}

	async findRecent(): Promise<
		readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]
	> {
		throw new Error('read failed');
	}

	async save(
		_snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

function createComparedSnapshot(
	id: string,
	generatedAt: string,
	totalCount: number
): CrossCheckApiDocsComparisonSnapshotListItemDTO {
	return {
		comparisonSummary: {
			fieldMismatchCount: 0,
			matchedCount: totalCount,
			sourceMissingCount: 0,
			stellarAtlasMissingCount: 0,
			totalCount
		},
		failure: null,
		generatedAt,
		id,
		status: 'compared',
		storedAt: '2026-07-03T12:05:01.000Z'
	};
}

function createFailedSnapshot(): CrossCheckApiDocsComparisonSnapshotListItemDTO {
	return {
		comparisonSummary: null,
		failure: {
			kind: 'timeout',
			message: 'RADAR API docs request timed out',
			occurredAt: '2026-07-03T12:00:00.000Z',
			phase: 'radar_fetch',
			sourceId: 'withobsrvr-radar'
		},
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-failed-1',
		status: 'failed',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}
