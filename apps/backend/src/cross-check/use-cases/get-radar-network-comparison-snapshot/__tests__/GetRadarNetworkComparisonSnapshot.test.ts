import type {
	CrossCheckRadarNetworkComparisonSnapshotListItemDTO,
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '../../../domain/CrossCheckRadarNetworkSnapshot.js';
import { GetRadarNetworkComparisonSnapshot } from '../GetRadarNetworkComparisonSnapshot.js';

describe('GetRadarNetworkComparisonSnapshot', () => {
	it('should return the latest persisted RADAR network comparison snapshot', async () => {
		const snapshot = createSnapshot();
		const useCase = new GetRadarNetworkComparisonSnapshot(
			new FakeSnapshotRepository(snapshot)
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap()).toBe(snapshot);
	});

	it('should return null when no RADAR network comparison snapshot exists', async () => {
		const useCase = new GetRadarNetworkComparisonSnapshot(
			new FakeSnapshotRepository(null)
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should return repository read failures as errors', async () => {
		const useCase = new GetRadarNetworkComparisonSnapshot(
			new FailingSnapshotRepository()
		);

		const result = await useCase.execute();

		expect(result._unsafeUnwrapErr().message).toBe('read failed');
	});
});

class FakeSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	constructor(
		private readonly latest: CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null
	) {}

	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		return this.latest;
	}

	async findRecent(): Promise<
		readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]
	> {
		throw new Error('not used');
	}

	async save(
		_snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

class FailingSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		throw new Error('read failed');
	}

	async findRecent(): Promise<
		readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]
	> {
		throw new Error('not used');
	}

	async save(
		_snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		throw new Error('not used');
	}
}

function createSnapshot(): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
	return {
		comparison: {
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T12:00:00.000Z',
			organizations: [],
			source: {
				endpointUrl: 'https://radar.withobsrvr.com/api/v1',
				latestLedger: '123',
				networkId: 'public',
				networkName: 'Public Global Stellar Network',
				networkTime: '2026-07-03T11:59:00.000Z',
				observedAt: '2026-07-03T11:59:00.000Z',
				organizationCount: 0,
				sourceId: 'withobsrvr-radar',
				validatorCount: 0,
				warnings: []
			},
			stellarAtlas: {
				observedAt: '2026-07-03T12:00:00.000Z',
				organizationCount: 0,
				sourceId: 'stellaratlas-api',
				validatorCount: 0
			},
			summary: {
				fieldMismatchCount: 0,
				matchedCount: 0,
				organizationCount: 0,
				sourceMissingCount: 0,
				stellarAtlasMissingCount: 0,
				totalCount: 0,
				validatorCount: 0
			},
			validators: [],
			warnings: []
		},
		failure: null,
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-1',
		status: 'compared',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}
