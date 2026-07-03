import type {
	CrossCheckApiDocsComparisonSnapshotListItemDTO,
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '../../../domain/CrossCheckApiDocsSnapshot.js';
import { GetApiDocsComparisonSnapshot } from '../GetApiDocsComparisonSnapshot.js';

describe('GetApiDocsComparisonSnapshot', () => {
	it('should return the latest persisted API docs comparison snapshot', async () => {
		const snapshot = createSnapshot();
		const useCase = new GetApiDocsComparisonSnapshot(
			new FakeSnapshotRepository(snapshot)
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap()).toBe(snapshot);
	});

	it('should return null when no API docs comparison snapshot exists', async () => {
		const useCase = new GetApiDocsComparisonSnapshot(
			new FakeSnapshotRepository(null)
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should return repository read failures as errors', async () => {
		const useCase = new GetApiDocsComparisonSnapshot(
			new FailingSnapshotRepository()
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrapErr().message).toBe('read failed');
	});
});

class FakeSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	constructor(
		private readonly latest: CrossCheckApiDocsComparisonSnapshotRecordDTO | null
	) {}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		return this.latest;
	}

	async findRecent(): Promise<
		readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]
	> {
		throw new Error('not used');
	}

	async save(
		_snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

class FailingSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		throw new Error('read failed');
	}

	async findRecent(): Promise<
		readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]
	> {
		throw new Error('not used');
	}

	async save(
		_snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

function createSnapshot(): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	return {
		comparison: {
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T12:00:00.000Z',
			operations: [],
			source: {
				documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
				observedAt: '2026-07-03T11:59:00.000Z',
				operationCount: 0,
				sourceId: 'withobsrvr-radar',
				title: 'RADAR API',
				version: '1.0.0'
			},
			stellarAtlas: {
				documentationUrl: '/docs',
				observedAt: '2026-07-03T12:00:00.000Z',
				operationCount: 0,
				sourceId: 'stellaratlas-api',
				title: 'StellarAtlas.io API',
				version: 'v1'
			},
			summary: {
				fieldMismatchCount: 0,
				matchedCount: 0,
				sourceMissingCount: 0,
				stellarAtlasMissingCount: 0,
				totalCount: 0
			}
		},
		failure: null,
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-1',
		status: 'compared',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}
