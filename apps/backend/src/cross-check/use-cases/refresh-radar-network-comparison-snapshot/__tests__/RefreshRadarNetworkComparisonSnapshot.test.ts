import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckRadarNetworkComparisonSnapshotListItemDTO,
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	CrossCheckStellarAtlasNetworkRowsSource,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '../../../domain/CrossCheckRadarNetworkSnapshot.js';
import type {
	CrossCheckRadarNetworkComparisonDTO,
	CrossCheckStellarAtlasNetworkRowsDTO
} from '../../../domain/CrossCheckRadarNetworkComparison.js';
import type {
	CrossCheckRadarNetworkSnapshotSource,
	RadarNetworkFetchOptions,
	RadarNetworkSnapshotDTO,
	RadarNetworkSnapshotFailureDTO
} from '../../../domain/RadarNetworkSnapshot.js';
import type { CompareRadarNetworkSnapshotDTO } from '../../compare-radar-network-snapshot/CompareRadarNetworkSnapshot.js';
import {
	type CrossCheckRadarNetworkComparer,
	RefreshRadarNetworkComparisonSnapshot
} from '../RefreshRadarNetworkComparisonSnapshot.js';

describe('RefreshRadarNetworkComparisonSnapshot', () => {
	it('should compare source rows and save a successful snapshot', async () => {
		const radarSnapshot = createRadarSnapshot();
		const stellarAtlasRows = createStellarAtlasRows();
		const comparison = createComparison({ totalCount: 2 });
		const radarSource = new FakeRadarSource(ok(radarSnapshot));
		const stellarAtlasSource = new FakeStellarAtlasSource(ok(stellarAtlasRows));
		const repository = new InMemoryRadarNetworkSnapshotRepository();
		const comparer = new FakeComparer(ok(comparison));

		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			radarSource,
			stellarAtlasSource,
			repository,
			comparer
		);
		const result = await useCase.execute({
			radar: { maxBytes: 512, timeoutMs: 50 }
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(radarSource.calls).toEqual([{ maxBytes: 512, timeoutMs: 50 }]);
		expect(stellarAtlasSource.calls).toBe(1);
		expect(comparer.calls).toEqual([
			{ radar: radarSnapshot, stellarAtlas: stellarAtlasRows }
		]);
		expect(result.value).toMatchObject({
			comparison,
			failure: null,
			generatedAt: comparison.generatedAt,
			id: 'snapshot-1',
			status: 'compared',
			storedAt: '2026-07-03T16:45:00.000Z'
		});
		await expect(repository.findLatest()).resolves.toEqual(result.value);
	});

	it('should save RADAR failures without reading StellarAtlas rows', async () => {
		const radarSource = new FakeRadarSource(
			err({ kind: 'timeout', message: 'RADAR timed out' })
		);
		const stellarAtlasSource = new FakeStellarAtlasSource(
			ok(createStellarAtlasRows())
		);
		const comparer = new FakeComparer(ok(createComparison()));
		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			radarSource,
			stellarAtlasSource,
			new InMemoryRadarNetworkSnapshotRepository(),
			comparer,
			() => new Date('2026-07-03T16:30:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(stellarAtlasSource.calls).toBe(0);
		expect(comparer.calls).toEqual([]);
		expect(result.value).toMatchObject({
			comparison: null,
			failure: {
				kind: 'timeout',
				message: 'RADAR timed out',
				occurredAt: '2026-07-03T16:30:00.000Z',
				phase: 'radar_fetch',
				sourceId: 'withobsrvr-radar'
			},
			generatedAt: '2026-07-03T16:30:00.000Z',
			status: 'failed'
		});
	});

	it('should preserve RADAR HTTP and byte-limit failure details', async () => {
		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			new FakeRadarSource(
				err({
					kind: 'http_status',
					limitBytes: 2000,
					message: 'RADAR returned HTTP 503',
					status: 503
				})
			),
			new FakeStellarAtlasSource(ok(createStellarAtlasRows())),
			new InMemoryRadarNetworkSnapshotRepository(),
			new FakeComparer(ok(createComparison())),
			() => new Date('2026-07-03T16:31:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.failure).toMatchObject({
			kind: 'http_status',
			limitBytes: 2000,
			status: 503
		});
	});

	it('should save StellarAtlas read failures after a successful RADAR fetch', async () => {
		const comparer = new FakeComparer(ok(createComparison()));
		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot())),
			new FakeStellarAtlasSource(err(new Error('network rows unavailable'))),
			new InMemoryRadarNetworkSnapshotRepository(),
			comparer,
			() => new Date('2026-07-03T16:32:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(comparer.calls).toEqual([]);
		expect(result.value.failure).toEqual({
			kind: 'stellaratlas_read_error',
			message: 'network rows unavailable',
			occurredAt: '2026-07-03T16:32:00.000Z',
			phase: 'stellaratlas_read',
			sourceId: 'stellaratlas-api'
		});
	});

	it('should save comparison failures as snapshot evidence', async () => {
		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot())),
			new FakeStellarAtlasSource(ok(createStellarAtlasRows())),
			new InMemoryRadarNetworkSnapshotRepository(),
			new FakeComparer(err(new Error('comparison failed'))),
			() => new Date('2026-07-03T16:33:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.failure).toEqual({
			kind: 'comparison_error',
			message: 'comparison failed',
			occurredAt: '2026-07-03T16:33:00.000Z',
			phase: 'comparison',
			sourceId: null
		});
	});

	it('should return repository save errors without hiding them', async () => {
		const useCase = new RefreshRadarNetworkComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot())),
			new FakeStellarAtlasSource(ok(createStellarAtlasRows())),
			new FailingRadarNetworkSnapshotRepository(),
			new FakeComparer(ok(createComparison()))
		);

		const result = await useCase.execute();

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected save failure');
		expect(result.error.message).toBe('snapshot store unavailable');
	});
});

class FakeRadarSource implements CrossCheckRadarNetworkSnapshotSource {
	readonly calls: (RadarNetworkFetchOptions | undefined)[] = [];

	constructor(
		private readonly result: Result<
			RadarNetworkSnapshotDTO,
			RadarNetworkSnapshotFailureDTO
		>
	) {}

	async fetchNetworkSnapshot(
		options?: RadarNetworkFetchOptions
	): Promise<Result<RadarNetworkSnapshotDTO, RadarNetworkSnapshotFailureDTO>> {
		this.calls.push(options);
		return this.result;
	}
}

class FakeStellarAtlasSource implements CrossCheckStellarAtlasNetworkRowsSource {
	calls = 0;

	constructor(
		private readonly result: Result<CrossCheckStellarAtlasNetworkRowsDTO, Error>
	) {}

	async readRows(): Promise<
		Result<CrossCheckStellarAtlasNetworkRowsDTO, Error>
	> {
		this.calls += 1;
		return this.result;
	}
}

class FakeComparer implements CrossCheckRadarNetworkComparer {
	readonly calls: CompareRadarNetworkSnapshotDTO[] = [];

	constructor(
		private readonly result: Result<CrossCheckRadarNetworkComparisonDTO, Error>
	) {}

	execute(
		dto: CompareRadarNetworkSnapshotDTO
	): Result<CrossCheckRadarNetworkComparisonDTO, Error> {
		this.calls.push(dto);
		return this.result;
	}
}

class InMemoryRadarNetworkSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	private readonly records: CrossCheckRadarNetworkComparisonSnapshotRecordDTO[] =
		[];

	async save(
		snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO
	): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		const record = createRecord(snapshot, this.records.length + 1);
		this.records.push(record);
		return record;
	}

	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		return this.records[0] ?? null;
	}

	async findRecent(
		limit: number
	): Promise<readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]> {
		return this.records.slice(0, limit).map(mapListItem);
	}
}

class FailingRadarNetworkSnapshotRepository implements CrossCheckRadarNetworkComparisonSnapshotRepository {
	async save(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO> {
		throw new Error('snapshot store unavailable');
	}

	async findLatest(): Promise<CrossCheckRadarNetworkComparisonSnapshotRecordDTO | null> {
		return null;
	}

	async findRecent(): Promise<
		readonly CrossCheckRadarNetworkComparisonSnapshotListItemDTO[]
	> {
		return [];
	}
}

function mapListItem(
	record: CrossCheckRadarNetworkComparisonSnapshotRecordDTO
): CrossCheckRadarNetworkComparisonSnapshotListItemDTO {
	if (record.status === 'compared') {
		return {
			comparisonSummary: record.comparison.summary,
			failure: null,
			generatedAt: record.generatedAt,
			id: record.id,
			status: record.status,
			storedAt: record.storedAt
		};
	}

	return {
		comparisonSummary: null,
		failure: record.failure,
		generatedAt: record.generatedAt,
		id: record.id,
		status: record.status,
		storedAt: record.storedAt
	};
}

function createRecord(
	snapshot: SaveCrossCheckRadarNetworkComparisonSnapshotDTO,
	index: number
): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
	return {
		...snapshot,
		id: `snapshot-${index}`,
		storedAt: '2026-07-03T16:45:00.000Z'
	};
}

function createRadarSnapshot(): RadarNetworkSnapshotDTO {
	return {
		contentHashSha256: 'fixture-hash',
		endpointUrl: 'https://radar.withobsrvr.com/api/v1',
		fetchedAt: '2026-07-03T16:00:00.000Z',
		latestLedger: '63311161',
		networkId: 'public',
		networkName: 'Public Stellar Network',
		networkTime: '2026-07-03T15:59:00.000Z',
		nodes: [],
		organizations: [],
		sourceId: 'withobsrvr-radar',
		warnings: []
	};
}

function createStellarAtlasRows(): CrossCheckStellarAtlasNetworkRowsDTO {
	return {
		organizations: {
			comparisonStatus: 'not_compared',
			count: 0,
			evidenceSelection: 'latest_network_snapshot_active_organizations',
			generatedAt: '2026-07-03T16:05:00.000Z',
			limit: 100,
			organizations: [],
			probe: 'not_run',
			totalEligibleCount: 0
		},
		validators: {
			comparisonStatus: 'not_compared',
			count: 0,
			evidenceSelection:
				'latest_network_snapshot_validator_or_validating_or_active_in_scp',
			generatedAt: '2026-07-03T16:05:00.000Z',
			limit: 100,
			probe: 'not_run',
			totalEligibleCount: 0,
			validators: []
		}
	};
}

function createComparison(
	summary: Partial<CrossCheckRadarNetworkComparisonDTO['summary']> = {}
): CrossCheckRadarNetworkComparisonDTO {
	return {
		comparisonStatus: 'compared',
		generatedAt: '2026-07-03T16:40:00.000Z',
		organizations: [],
		source: {
			endpointUrl: 'https://radar.withobsrvr.com/api/v1',
			latestLedger: '63311161',
			networkId: 'public',
			networkName: 'Public Stellar Network',
			networkTime: '2026-07-03T15:59:00.000Z',
			observedAt: '2026-07-03T16:00:00.000Z',
			organizationCount: 0,
			sourceId: 'withobsrvr-radar',
			validatorCount: 0,
			warnings: []
		},
		stellarAtlas: {
			observedAt: '2026-07-03T16:05:00.000Z',
			organizationCount: 0,
			sourceId: 'stellaratlas-api',
			validatorCount: 0
		},
		summary: {
			fieldMismatchCount: summary.fieldMismatchCount ?? 0,
			matchedCount: summary.matchedCount ?? 0,
			organizationCount: summary.organizationCount ?? 0,
			sourceMissingCount: summary.sourceMissingCount ?? 0,
			stellarAtlasMissingCount: summary.stellarAtlasMissingCount ?? 0,
			totalCount: summary.totalCount ?? 0,
			validatorCount: summary.validatorCount ?? 0
		},
		validators: [],
		warnings: []
	};
}
