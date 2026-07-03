import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { DataSource } from 'typeorm';
import type {
	CrossCheckApiDocsComparisonDTO,
	CrossCheckApiDocsOperationDTO
} from '@cross-check/domain/CrossCheckApiDocsComparison.js';
import type {
	CrossCheckApiDocsSnapshotFailureDTO,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '@cross-check/domain/CrossCheckApiDocsSnapshot.js';
import { CrossCheckApiDocsComparisonSnapshot } from '../../entities/CrossCheckApiDocsComparisonSnapshot.js';
import { TypeOrmCrossCheckApiDocsComparisonSnapshotRepository } from '../TypeOrmCrossCheckApiDocsComparisonSnapshotRepository.js';

jest.setTimeout(30000);

describe('TypeOrmCrossCheckApiDocsComparisonSnapshotRepository.integration', () => {
	let kernel: Kernel;
	let dataSource: DataSource;
	let repository: TypeOrmCrossCheckApiDocsComparisonSnapshotRepository;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		dataSource = kernel.container.get(DataSource);
		repository = new TypeOrmCrossCheckApiDocsComparisonSnapshotRepository(
			dataSource.getRepository(CrossCheckApiDocsComparisonSnapshot)
		);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should return null when no snapshots have been stored', async () => {
		await expect(repository.findLatest()).resolves.toBeNull();
	});

	it('should save successful comparison snapshots', async () => {
		const comparison = createComparisonSnapshot({
			generatedAt: '2026-07-03T12:40:00.000Z',
			totalCount: 2
		});

		const saved = await repository.save({
			comparison,
			failure: null,
			generatedAt: comparison.generatedAt,
			status: 'compared'
		});

		expect(saved.id).toEqual(expect.any(String));
		expect(saved.storedAt).toEqual(expect.any(String));
		expect(saved).toMatchObject({
			comparison,
			failure: null,
			generatedAt: '2026-07-03T12:40:00.000Z',
			status: 'compared'
		});
	});

	it('should save failed snapshots with source failure details', async () => {
		const failure = createFailure({
			limitBytes: 1000,
			status: 503
		});

		const saved = await repository.save({
			comparison: null,
			failure,
			generatedAt: failure.occurredAt,
			status: 'failed'
		});

		expect(saved).toMatchObject({
			comparison: null,
			failure,
			generatedAt: '2026-07-03T12:41:00.000Z',
			status: 'failed'
		});
	});

	it('should return the latest generated snapshot', async () => {
		const newer = await repository.save(
			createSaveDTO('2026-07-03T12:05:00.000Z', 2)
		);
		const olderSavedLater = await repository.save(
			createSaveDTO('2026-07-03T12:00:00.000Z', 1)
		);

		const latest = await repository.findLatest();

		expect(latest?.id).toBe(newer.id);
		expect(latest?.id).not.toBe(olderSavedLater.id);
		expect(latest?.status).toBe('compared');
	});

	it('should return recent snapshots using latest ordering and limit', async () => {
		const newest = await repository.save(
			createSaveDTO('2026-07-03T12:10:00.000Z', 3)
		);
		await repository.save(createSaveDTO('2026-07-03T12:00:00.000Z', 1));
		const middle = await repository.save({
			comparison: null,
			failure: createFailure({
				occurredAt: '2026-07-03T12:05:00.000Z'
			}),
			generatedAt: '2026-07-03T12:05:00.000Z',
			status: 'failed'
		});

		const recent = await repository.findRecent(2);

		expect(recent.map((snapshot) => snapshot.id)).toEqual([
			newest.id,
			middle.id
		]);
		expect(recent[0]?.status).toBe('compared');
		expect(recent[1]?.status).toBe('failed');
	});

	it('should use storedAt and id tie-breakers for matching generatedAt values', async () => {
		const first = await repository.save(
			createSaveDTO('2026-07-03T12:10:00.000Z', 1)
		);
		const second = await repository.save(
			createSaveDTO('2026-07-03T12:10:00.000Z', 1)
		);
		const sameGeneratedAt = new Date('2026-07-03T12:10:00.000Z');
		const sameStoredAt = new Date('2026-07-03T12:11:00.000Z');
		await dataSource.query(
			`
			update cross_check_api_docs_comparison_snapshots
			set generated_at = $1,
				stored_at = $2
			where id in ($3, $4)
			`,
			[sameGeneratedAt, sameStoredAt, first.id, second.id]
		);

		const latest = await repository.findLatest();

		expect(latest?.id).toBe([first.id, second.id].sort().at(-1));
	});

	it('should save failed snapshots as latest when they have the latest generatedAt', async () => {
		const older = await repository.save(
			createSaveDTO('2026-07-03T12:00:00.000Z', 1)
		);
		const newerFailure = await repository.save({
			comparison: null,
			failure: createFailure({
				occurredAt: '2026-07-03T12:05:00.000Z'
			}),
			generatedAt: '2026-07-03T12:05:00.000Z',
			status: 'failed'
		});

		const latest = await repository.findLatest();

		expect(latest?.id).toBe(newerFailure.id);
		expect(latest?.id).not.toBe(older.id);
		expect(latest?.status).toBe('failed');
	});

	it('should reject invalid generatedAt values before writing', async () => {
		await expect(
			repository.save({
				comparison: createComparisonSnapshot({
					generatedAt: 'not-a-date',
					totalCount: 1
				}),
				failure: null,
				generatedAt: 'not-a-date',
				status: 'compared'
			})
		).rejects.toThrow('API docs snapshot is missing valid generatedAt');
	});

	it('should reject comparison snapshots with mismatched generatedAt values', async () => {
		await expect(
			repository.save({
				comparison: createComparisonSnapshot({
					generatedAt: '2026-07-03T12:00:00.000Z',
					totalCount: 1
				}),
				failure: null,
				generatedAt: '2026-07-03T12:01:00.000Z',
				status: 'compared'
			})
		).rejects.toThrow(
			'API docs comparison snapshot generatedAt must match comparison.generatedAt'
		);
	});

	it('should reject failure snapshots with mismatched generatedAt values', async () => {
		await expect(
			repository.save({
				comparison: null,
				failure: createFailure({
					occurredAt: '2026-07-03T12:00:00.000Z'
				}),
				generatedAt: '2026-07-03T12:01:00.000Z',
				status: 'failed'
			})
		).rejects.toThrow(
			'API docs failure snapshot generatedAt must match failure.occurredAt'
		);
	});

	it('should reject failure snapshots with invalid occurredAt values', async () => {
		await expect(
			repository.save({
				comparison: null,
				failure: createFailure({
					occurredAt: 'not-a-date'
				}),
				generatedAt: '2026-07-03T12:01:00.000Z',
				status: 'failed'
			})
		).rejects.toThrow('API docs snapshot is missing valid failure.occurredAt');
	});
});

function createSaveDTO(
	generatedAt: string,
	totalCount: number
): SaveCrossCheckApiDocsComparisonSnapshotDTO {
	const comparison = createComparisonSnapshot({ generatedAt, totalCount });
	return {
		comparison,
		failure: null,
		generatedAt: comparison.generatedAt,
		status: 'compared'
	};
}

function createComparisonSnapshot(overrides: {
	readonly generatedAt: string;
	readonly totalCount: number;
}): CrossCheckApiDocsComparisonDTO {
	return {
		comparisonStatus: 'compared',
		generatedAt: overrides.generatedAt,
		operations: [createOperationComparison()],
		source: {
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			observedAt: '2026-07-03T11:59:00.000Z',
			operationCount: overrides.totalCount,
			sourceId: 'withobsrvr-radar',
			title: 'RADAR API',
			version: '1.0.0'
		},
		stellarAtlas: {
			documentationUrl: '/docs',
			observedAt: '2026-07-03T12:00:00.000Z',
			operationCount: overrides.totalCount,
			sourceId: 'stellaratlas-api',
			title: 'StellarAtlas.io API',
			version: 'v1'
		},
		summary: {
			fieldMismatchCount: 0,
			matchedCount: overrides.totalCount,
			sourceMissingCount: 0,
			stellarAtlasMissingCount: 0,
			totalCount: overrides.totalCount
		}
	};
}

function createOperationComparison(): CrossCheckApiDocsComparisonDTO['operations'][number] {
	const operation: CrossCheckApiDocsOperationDTO = {
		method: 'get',
		operationId: 'getNetwork',
		path: '/v1',
		schemaRefs: [],
		summary: 'Network',
		tags: ['Network']
	};

	return {
		comparisonStatus: 'matched',
		fieldMismatches: [],
		key: { method: 'get', path: '/v1' },
		source: operation,
		stellarAtlas: operation
	};
}

function createFailure(
	overrides: Partial<CrossCheckApiDocsSnapshotFailureDTO> = {}
): CrossCheckApiDocsSnapshotFailureDTO {
	return {
		kind: overrides.kind ?? 'http_status',
		limitBytes: overrides.limitBytes,
		message: overrides.message ?? 'RADAR returned HTTP 503',
		occurredAt: overrides.occurredAt ?? '2026-07-03T12:41:00.000Z',
		phase: overrides.phase ?? 'radar_fetch',
		sourceId: overrides.sourceId ?? 'withobsrvr-radar',
		status: overrides.status
	};
}
