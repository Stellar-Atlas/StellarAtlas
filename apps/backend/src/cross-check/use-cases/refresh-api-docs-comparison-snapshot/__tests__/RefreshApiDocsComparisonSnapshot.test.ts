import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonSnapshotListItemDTO,
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '../../../domain/CrossCheckApiDocsSnapshot.js';
import type {
	CrossCheckApiDocsComparisonDTO,
	CrossCheckApiDocsOperationDTO,
	StellarAtlasApiDocsOperationSnapshotDTO
} from '../../../domain/CrossCheckApiDocsComparison.js';
import type {
	CrossCheckRadarApiDocsSource,
	CrossCheckStellarAtlasApiDocsReadOptions,
	CrossCheckStellarAtlasApiDocsSource,
	RadarApiDocsFetchOptions,
	StellarAtlasApiDocsFailureDTO
} from '../../../domain/CrossCheckApiDocsSources.js';
import type {
	RadarApiDocsFailureDTO,
	RadarApiDocsSnapshotDTO,
	RadarApiOperationMethod
} from '../../../domain/RadarApiDocs.js';
import type { CompareRadarApiDocsOperationsDTO } from '../../compare-radar-api-docs/CompareRadarApiDocsOperations.js';
import {
	type CrossCheckApiDocsComparer,
	RefreshApiDocsComparisonSnapshot
} from '../RefreshApiDocsComparisonSnapshot.js';

describe('RefreshApiDocsComparisonSnapshot', () => {
	it('should compare source docs and save a successful snapshot', async () => {
		const radarSnapshot = createRadarSnapshot([createOperation()]);
		const stellarAtlasSnapshot = createStellarAtlasSnapshot([
			createOperation()
		]);
		const comparison = createComparison({ totalCount: 1 });
		const radarSource = new FakeRadarSource(ok(radarSnapshot));
		const stellarAtlasSource = new FakeStellarAtlasSource(
			ok(stellarAtlasSnapshot)
		);
		const repository = new InMemoryApiDocsSnapshotRepository();
		const comparer = new FakeComparer(ok(comparison));

		const useCase = new RefreshApiDocsComparisonSnapshot(
			radarSource,
			stellarAtlasSource,
			repository,
			comparer
		);
		const result = await useCase.execute({
			radar: { maxBytes: 256, timeoutMs: 25 },
			stellarAtlas: { documentationUrl: '/docs' }
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(radarSource.calls).toEqual([{ maxBytes: 256, timeoutMs: 25 }]);
		expect(stellarAtlasSource.calls).toEqual([{ documentationUrl: '/docs' }]);
		expect(comparer.calls).toEqual([
			{ radar: radarSnapshot, stellarAtlas: stellarAtlasSnapshot }
		]);
		expect(result.value).toMatchObject({
			comparison,
			failure: null,
			generatedAt: comparison.generatedAt,
			id: 'snapshot-1',
			status: 'compared',
			storedAt: '2026-07-03T12:45:00.000Z'
		});
		await expect(repository.findLatest()).resolves.toEqual(result.value);
	});

	it('should save RADAR fetch failures without reading StellarAtlas docs', async () => {
		const radarSource = new FakeRadarSource(
			err({
				kind: 'timeout',
				message: 'RADAR timed out'
			})
		);
		const stellarAtlasSource = new FakeStellarAtlasSource(
			ok(createStellarAtlasSnapshot([]))
		);
		const repository = new InMemoryApiDocsSnapshotRepository();
		const comparer = new FakeComparer(ok(createComparison()));
		const useCase = new RefreshApiDocsComparisonSnapshot(
			radarSource,
			stellarAtlasSource,
			repository,
			comparer,
			() => new Date('2026-07-03T12:30:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(stellarAtlasSource.calls).toEqual([]);
		expect(comparer.calls).toEqual([]);
		expect(result.value).toMatchObject({
			comparison: null,
			failure: {
				kind: 'timeout',
				message: 'RADAR timed out',
				occurredAt: '2026-07-03T12:30:00.000Z',
				phase: 'radar_fetch',
				sourceId: 'withobsrvr-radar'
			},
			generatedAt: '2026-07-03T12:30:00.000Z',
			status: 'failed'
		});
	});

	it('should keep RADAR HTTP failure details on the failed snapshot', async () => {
		const radarSource = new FakeRadarSource(
			err({
				kind: 'http_status',
				limitBytes: 1000,
				message: 'RADAR returned HTTP 503',
				status: 503
			})
		);
		const repository = new InMemoryApiDocsSnapshotRepository();
		const useCase = new RefreshApiDocsComparisonSnapshot(
			radarSource,
			new FakeStellarAtlasSource(ok(createStellarAtlasSnapshot([]))),
			repository,
			new FakeComparer(ok(createComparison())),
			() => new Date('2026-07-03T12:31:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.failure).toMatchObject({
			kind: 'http_status',
			limitBytes: 1000,
			status: 503
		});
	});

	it('should save StellarAtlas OpenAPI failures after a successful RADAR fetch', async () => {
		const repository = new InMemoryApiDocsSnapshotRepository();
		const comparer = new FakeComparer(ok(createComparison()));
		const useCase = new RefreshApiDocsComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot([]))),
			new FakeStellarAtlasSource(
				err({
					kind: 'invalid_openapi',
					message: 'OpenAPI doc is missing paths'
				})
			),
			repository,
			comparer,
			() => new Date('2026-07-03T12:32:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(comparer.calls).toEqual([]);
		expect(result.value.failure).toEqual({
			kind: 'invalid_openapi',
			message: 'OpenAPI doc is missing paths',
			occurredAt: '2026-07-03T12:32:00.000Z',
			phase: 'stellaratlas_read',
			sourceId: 'stellaratlas-api'
		});
	});

	it('should save comparison failures as snapshot evidence', async () => {
		const repository = new InMemoryApiDocsSnapshotRepository();
		const useCase = new RefreshApiDocsComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot([]))),
			new FakeStellarAtlasSource(ok(createStellarAtlasSnapshot([]))),
			repository,
			new FakeComparer(err(new Error('comparison failed'))),
			() => new Date('2026-07-03T12:33:00.000Z')
		);

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.failure).toEqual({
			kind: 'comparison_error',
			message: 'comparison failed',
			occurredAt: '2026-07-03T12:33:00.000Z',
			phase: 'comparison',
			sourceId: null
		});
	});

	it('should return repository save errors without hiding them', async () => {
		const useCase = new RefreshApiDocsComparisonSnapshot(
			new FakeRadarSource(ok(createRadarSnapshot([]))),
			new FakeStellarAtlasSource(ok(createStellarAtlasSnapshot([]))),
			new FailingApiDocsSnapshotRepository(),
			new FakeComparer(ok(createComparison()))
		);

		const result = await useCase.execute();

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected save failure');
		expect(result.error.message).toBe('snapshot store unavailable');
	});
});

class FakeRadarSource implements CrossCheckRadarApiDocsSource {
	readonly calls: (RadarApiDocsFetchOptions | undefined)[] = [];

	constructor(
		private readonly result: Result<
			RadarApiDocsSnapshotDTO,
			RadarApiDocsFailureDTO
		>
	) {}

	async fetchDocs(
		options?: RadarApiDocsFetchOptions
	): Promise<Result<RadarApiDocsSnapshotDTO, RadarApiDocsFailureDTO>> {
		this.calls.push(options);
		return this.result;
	}
}

class FakeStellarAtlasSource implements CrossCheckStellarAtlasApiDocsSource {
	readonly calls: (CrossCheckStellarAtlasApiDocsReadOptions | undefined)[] = [];

	constructor(
		private readonly result: Result<
			StellarAtlasApiDocsOperationSnapshotDTO,
			StellarAtlasApiDocsFailureDTO
		>
	) {}

	readDocs(
		options?: CrossCheckStellarAtlasApiDocsReadOptions
	): Result<
		StellarAtlasApiDocsOperationSnapshotDTO,
		StellarAtlasApiDocsFailureDTO
	> {
		this.calls.push(options);
		return this.result;
	}
}

class FakeComparer implements CrossCheckApiDocsComparer {
	readonly calls: CompareRadarApiDocsOperationsDTO[] = [];

	constructor(
		private readonly result: Result<CrossCheckApiDocsComparisonDTO, Error>
	) {}

	execute(
		dto: CompareRadarApiDocsOperationsDTO
	): Result<CrossCheckApiDocsComparisonDTO, Error> {
		this.calls.push(dto);
		return this.result;
	}
}

class InMemoryApiDocsSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	private readonly records: CrossCheckApiDocsComparisonSnapshotRecordDTO[] = [];

	async save(
		snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		const record = createRecord(snapshot, this.records.length + 1);
		this.records.push(record);
		return record;
	}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		return this.records[0] ?? null;
	}

	async findRecent(
		limit: number
	): Promise<readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]> {
		return this.records.slice(0, limit).map(mapListItem);
	}
}

class FailingApiDocsSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	async save(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('snapshot store unavailable');
	}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		return null;
	}

	async findRecent(): Promise<
		readonly CrossCheckApiDocsComparisonSnapshotListItemDTO[]
	> {
		return [];
	}
}

function mapListItem(
	record: CrossCheckApiDocsComparisonSnapshotRecordDTO
): CrossCheckApiDocsComparisonSnapshotListItemDTO {
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
	snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO,
	index: number
): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	if (snapshot.status === 'compared') {
		return {
			...snapshot,
			id: `snapshot-${index}`,
			storedAt: '2026-07-03T12:45:00.000Z'
		};
	}

	return {
		...snapshot,
		id: `snapshot-${index}`,
		storedAt: '2026-07-03T12:45:00.000Z'
	};
}

function createRadarSnapshot(
	operations: readonly CrossCheckApiDocsOperationDTO[]
): RadarApiDocsSnapshotDTO {
	return {
		assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
		contentHashSha256: 'fixture-hash',
		documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
		fetchedAt: '2026-07-03T12:00:00.000Z',
		openapiVersion: '3.0.3',
		operations,
		servers: [{ description: null, url: 'https://radar.withobsrvr.com/api' }],
		sourceId: 'withobsrvr-radar',
		title: 'RADAR API',
		version: '1.0.0',
		warnings: []
	};
}

function createStellarAtlasSnapshot(
	operations: readonly CrossCheckApiDocsOperationDTO[]
): StellarAtlasApiDocsOperationSnapshotDTO {
	return {
		documentationUrl: '/docs',
		loadedAt: '2026-07-03T12:05:00.000Z',
		operations,
		sourceId: 'stellaratlas-api',
		title: 'StellarAtlas.io API',
		version: 'v1'
	};
}

function createComparison(
	summary: Partial<CrossCheckApiDocsComparisonDTO['summary']> = {}
): CrossCheckApiDocsComparisonDTO {
	return {
		comparisonStatus: 'compared',
		generatedAt: '2026-07-03T12:40:00.000Z',
		operations: [],
		source: {
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			observedAt: '2026-07-03T12:00:00.000Z',
			operationCount: 0,
			sourceId: 'withobsrvr-radar',
			title: 'RADAR API',
			version: '1.0.0'
		},
		stellarAtlas: {
			documentationUrl: '/docs',
			observedAt: '2026-07-03T12:05:00.000Z',
			operationCount: 0,
			sourceId: 'stellaratlas-api',
			title: 'StellarAtlas.io API',
			version: 'v1'
		},
		summary: {
			fieldMismatchCount: summary.fieldMismatchCount ?? 0,
			matchedCount: summary.matchedCount ?? 0,
			sourceMissingCount: summary.sourceMissingCount ?? 0,
			stellarAtlasMissingCount: summary.stellarAtlasMissingCount ?? 0,
			totalCount: summary.totalCount ?? 0
		}
	};
}

function createOperation(): CrossCheckApiDocsOperationDTO {
	return {
		method: 'get' satisfies RadarApiOperationMethod,
		operationId: 'getNetwork',
		path: '/v1',
		schemaRefs: [],
		summary: 'Network',
		tags: ['Network']
	};
}
