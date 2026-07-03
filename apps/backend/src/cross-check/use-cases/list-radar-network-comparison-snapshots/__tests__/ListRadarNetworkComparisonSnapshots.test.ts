import type {
	CrossCheckRadarNetworkComparisonSnapshotListItemDTO,
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '../../../domain/CrossCheckRadarNetworkSnapshot.js';
import { ListRadarNetworkComparisonSnapshots } from '../ListRadarNetworkComparisonSnapshots.js';

describe('ListRadarNetworkComparisonSnapshots', () => {
	it('should return recent persisted RADAR network comparison snapshot summaries', async () => {
		const snapshots = [
			createComparedSnapshot('snapshot-2', '2026-07-03T12:05:00.000Z', 2),
			createFailedSnapshot()
		];
		const repository = new FakeSnapshotRepository(snapshots);
		const useCase = new ListRadarNetworkComparisonSnapshots(repository);

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
						organizationCount: 1,
						sourceMissingCount: 0,
						stellarAtlasMissingCount: 0,
						totalCount: 2,
						validatorCount: 1
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
		expect(response.snapshots[0]).not.toHaveProperty('validators');
		expect(response.snapshots[0]).not.toHaveProperty('organizations');
	});

	it('should use the default limit when no limit is supplied', async () => {
		const repository = new FakeSnapshotRepository([]);
		const useCase = new ListRadarNetworkComparisonSnapshots(repository);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap().limit).toBe(10);
		expect(repository.lastLimit).toBe(10);
	});

	it('should cap the limit at the maximum', async () => {
		const repository = new FakeSnapshotRepository([]);
		const useCase = new ListRadarNetworkComparisonSnapshots(repository);

		const result = await useCase.execute({ limit: 100 });

		expect(result._unsafeUnwrap().limit).toBe(25);
		expect(repository.lastLimit).toBe(25);
	});

	it('should return repository read failures as errors', async () => {
		const useCase = new ListRadarNetworkComparisonSnapshots(
			new FailingSnapshotRepository()
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrapErr().message).toBe('read failed');
	});
});

class FakeSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	lastLimit: number | null = null;

	constructor(
		private readonly snapshots: readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]
	) {}

	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		throw new Error('not used');
	}

	async findRecent(
		limit: number
	): Promise<readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]> {
		this.lastLimit = limit;
		return this.snapshots.slice(0, limit);
	}

	async save(
		_snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

class FailingSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		throw new Error('not used');
	}

	async findRecent(): Promise<
		readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]
	> {
		throw new Error('read failed');
	}

	async save(
		_snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

function createComparedSnapshot(
	id: string,
	generatedAt: string,
	totalCount: number
): CrossCheckRadarNetworkComparisonSnapshotListItemDTO {
	return {
		comparisonSummary: {
			fieldMismatchCount: 0,
			matchedCount: totalCount,
			organizationCount: 1,
			sourceMissingCount: 0,
			stellarAtlasMissingCount: 0,
			totalCount,
			validatorCount: 1
		},
		failure: null,
		generatedAt,
		id,
		status: 'compared',
		storedAt: '2026-07-03T12:05:01.000Z'
	};
}

function createFailedSnapshot(): CrossCheckRadarNetworkComparisonSnapshotListItemDTO {
	return {
		comparisonSummary: null,
		failure: {
			kind: 'timeout',
			message: 'RADAR network request timed out',
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
