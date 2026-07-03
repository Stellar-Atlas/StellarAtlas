import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { DataSource } from 'typeorm';
import type { CrossCheckRadarNetworkComparisonDTO } from '@cross-check/domain/CrossCheckRadarNetworkComparison.js';
import type {
	CrossCheckRadarNetworkSnapshotFailureDTO,
	SaveCrossCheckRadarNetworkComparisonSnapshotDTO
} from '@cross-check/domain/CrossCheckRadarNetworkSnapshot.js';
import { CrossCheckRadarNetworkComparisonSnapshot } from '../../entities/CrossCheckRadarNetworkComparisonSnapshot.js';
import { TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository } from '../TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository.js';

jest.setTimeout(30000);

describe('TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository.integration', () => {
	let kernel: Kernel;
	let dataSource: DataSource;
	let repository: TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		dataSource = kernel.container.get(DataSource);
		repository = new TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository(
			dataSource.getRepository(CrossCheckRadarNetworkComparisonSnapshot)
		);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should return null when no RADAR network snapshots have been stored', async () => {
		await expect(repository.findLatest()).resolves.toBeNull();
	});

	it('should save successful comparison snapshots', async () => {
		const comparison = createComparisonSnapshot({
			generatedAt: '2026-07-03T16:40:00.000Z',
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
			generatedAt: '2026-07-03T16:40:00.000Z',
			status: 'compared'
		});
	});

	it('should save failed snapshots with RADAR failure details', async () => {
		const failure = createFailure({
			limitBytes: 2000,
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
			generatedAt: '2026-07-03T16:41:00.000Z',
			status: 'failed'
		});
	});

	it('should return the latest snapshot by generatedAt with deterministic tie-breakers', async () => {
		const first = await repository.save(
			createSaveDTO('2026-07-03T16:10:00.000Z', 1)
		);
		const second = await repository.save(
			createSaveDTO('2026-07-03T16:10:00.000Z', 1)
		);
		const olderSavedLater = await repository.save(
			createSaveDTO('2026-07-03T16:00:00.000Z', 1)
		);
		await dataSource.query(
			`
			update cross_check_radar_network_comparison_snapshots
			set generated_at = $1,
				stored_at = $2
			where id in ($3, $4)
			`,
			[
				new Date('2026-07-03T16:10:00.000Z'),
				new Date('2026-07-03T16:11:00.000Z'),
				first.id,
				second.id
			]
		);

		const latest = await repository.findLatest();

		expect(latest?.id).toBe([first.id, second.id].sort().at(-1));
		expect(latest?.id).not.toBe(olderSavedLater.id);
	});

	it('should return recent summary rows using latest ordering and limit', async () => {
		const newest = await repository.save(
			createSaveDTO('2026-07-03T16:20:00.000Z', 3)
		);
		await repository.save(createSaveDTO('2026-07-03T16:00:00.000Z', 1));
		const middle = await repository.save({
			comparison: null,
			failure: createFailure({
				occurredAt: '2026-07-03T16:10:00.000Z',
				phase: 'comparison'
			}),
			generatedAt: '2026-07-03T16:10:00.000Z',
			status: 'failed'
		});

		const recent = await repository.findRecent(2);

		expect(recent.map((snapshot) => snapshot.id)).toEqual([
			newest.id,
			middle.id
		]);
		expect(recent[0]).toMatchObject({
			comparisonSummary: {
				matchedCount: 3,
				totalCount: 3
			},
			failure: null,
			status: 'compared'
		});
		expect(recent[1]).toMatchObject({
			comparisonSummary: null,
			failure: {
				phase: 'comparison'
			},
			status: 'failed'
		});
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
		).rejects.toThrow('RADAR network snapshot is missing valid generatedAt');
	});

	it('should reject comparison snapshots with mismatched generatedAt values', async () => {
		await expect(
			repository.save({
				comparison: createComparisonSnapshot({
					generatedAt: '2026-07-03T16:00:00.000Z',
					totalCount: 1
				}),
				failure: null,
				generatedAt: '2026-07-03T16:01:00.000Z',
				status: 'compared'
			})
		).rejects.toThrow(
			'RADAR network comparison snapshot generatedAt must match comparison.generatedAt'
		);
	});

	it('should reject failure snapshots with mismatched generatedAt values', async () => {
		await expect(
			repository.save({
				comparison: null,
				failure: createFailure({
					occurredAt: '2026-07-03T16:00:00.000Z'
				}),
				generatedAt: '2026-07-03T16:01:00.000Z',
				status: 'failed'
			})
		).rejects.toThrow(
			'RADAR network failure snapshot generatedAt must match failure.occurredAt'
		);
	});
});

function createSaveDTO(
	generatedAt: string,
	totalCount: number
): SaveCrossCheckRadarNetworkComparisonSnapshotDTO {
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
}): CrossCheckRadarNetworkComparisonDTO {
	return {
		comparisonStatus: 'compared',
		generatedAt: overrides.generatedAt,
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
			validatorCount: overrides.totalCount,
			warnings: []
		},
		stellarAtlas: {
			observedAt: '2026-07-03T16:05:00.000Z',
			organizationCount: 0,
			sourceId: 'stellaratlas-api',
			validatorCount: overrides.totalCount
		},
		summary: {
			fieldMismatchCount: 0,
			matchedCount: overrides.totalCount,
			organizationCount: 0,
			sourceMissingCount: 0,
			stellarAtlasMissingCount: 0,
			totalCount: overrides.totalCount,
			validatorCount: overrides.totalCount
		},
		validators: [],
		warnings: []
	};
}

function createFailure(
	overrides: Partial<CrossCheckRadarNetworkSnapshotFailureDTO> = {}
): CrossCheckRadarNetworkSnapshotFailureDTO {
	return {
		kind: overrides.kind ?? 'http_status',
		limitBytes: overrides.limitBytes,
		message: overrides.message ?? 'RADAR returned HTTP 503',
		occurredAt: overrides.occurredAt ?? '2026-07-03T16:41:00.000Z',
		phase: overrides.phase ?? 'radar_fetch',
		sourceId: overrides.sourceId ?? 'withobsrvr-radar',
		status: overrides.status
	};
}
