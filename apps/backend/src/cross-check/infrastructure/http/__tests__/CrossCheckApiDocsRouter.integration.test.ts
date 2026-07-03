import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonSnapshotListDTO,
	CrossCheckApiDocsComparisonSnapshotRecordDTO
} from '@cross-check/domain/CrossCheckApiDocsSnapshot.js';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetRadarNetworkComparisonSnapshot } from '@cross-check/use-cases/get-radar-network-comparison-snapshot/GetRadarNetworkComparisonSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '@cross-check/use-cases/list-api-docs-comparison-snapshots/ListApiDocsComparisonSnapshots.js';
import { ListRadarNetworkComparisonSnapshots } from '@cross-check/use-cases/list-radar-network-comparison-snapshots/ListRadarNetworkComparisonSnapshots.js';
import { CrossCheckRouterWrapper } from '../CrossCheckRouter.js';

describe('CrossCheckApiDocsRouter.integration', () => {
	let app: express.Application;
	let getApiDocsComparisonSnapshot: jest.Mocked<GetApiDocsComparisonSnapshot>;
	let listApiDocsComparisonSnapshots: jest.Mocked<ListApiDocsComparisonSnapshots>;

	beforeEach(() => {
		getApiDocsComparisonSnapshot = mock<GetApiDocsComparisonSnapshot>();
		listApiDocsComparisonSnapshots = mock<ListApiDocsComparisonSnapshots>();
		app = express();
		app.use(
			'/cross-check',
			CrossCheckRouterWrapper({
				getApiDocsComparisonSnapshot,
				getCrossCheckArchives: mock<GetCrossCheckArchives>(),
				getCrossCheckOrganizations: mock<GetCrossCheckOrganizations>(),
				getCrossCheckSources: mock<GetCrossCheckSources>(),
				getCrossCheckValidators: mock<GetCrossCheckValidators>(),
				getRadarNetworkComparisonSnapshot:
					mock<GetRadarNetworkComparisonSnapshot>(),
				listApiDocsComparisonSnapshots,
				listRadarNetworkComparisonSnapshots:
					mock<ListRadarNetworkComparisonSnapshots>()
			})
		);
	});

	it('should expose recent persisted API docs comparison snapshots', async () => {
		listApiDocsComparisonSnapshots.execute.mockResolvedValue(
			ok(createApiDocsSnapshotList())
		);

		await request(app)
			.get('/cross-check/api-docs/snapshots?limit=2')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.body.count).toBe(2);
				expect(response.body.snapshots[0].status).toBe('compared');
				expect(response.body.snapshots[0].comparisonSummary.totalCount).toBe(1);
				expect(response.body.snapshots[0].comparison).toBeUndefined();
				expect(response.body.snapshots[0].operations).toBeUndefined();
				expect(response.body.snapshots[1].status).toBe('failed');
				expect(response.body.snapshots[1].failure.phase).toBe('radar_fetch');
			});
		expect(listApiDocsComparisonSnapshots.execute).toHaveBeenCalledWith({
			limit: 2
		});
	});

	it.each(['0', '26', '1.5'])(
		'should reject invalid API docs comparison snapshot limit %s',
		async (limit) => {
			await request(app)
				.get('/cross-check/api-docs/snapshots?limit=' + limit)
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toHaveLength(1);
				});
		}
	);

	it('should hide API docs comparison snapshot list internal errors', async () => {
		listApiDocsComparisonSnapshots.execute.mockResolvedValue(
			err(new Error('boom'))
		);

		await request(app)
			.get('/cross-check/api-docs/snapshots')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});

	it('should expose the latest persisted API docs comparison snapshot', async () => {
		getApiDocsComparisonSnapshot.execute.mockResolvedValue(
			ok(createApiDocsSnapshot())
		);

		await request(app)
			.get('/cross-check/api-docs/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.body.status).toBe('compared');
				expect(response.body.comparison.summary.totalCount).toBe(1);
				expect(response.body.comparison.operations[0].comparisonStatus).toBe(
					'matched'
				);
			});
	});

	it('should return 204 when no API docs comparison snapshot exists', async () => {
		getApiDocsComparisonSnapshot.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/cross-check/api-docs/latest')
			.expect(204)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.text).toBe('');
			});
	});

	it('should expose persisted API docs comparison failure snapshots', async () => {
		getApiDocsComparisonSnapshot.execute.mockResolvedValue(
			ok(createFailedApiDocsSnapshot())
		);

		await request(app)
			.get('/cross-check/api-docs/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.body.status).toBe('failed');
				expect(response.body.comparison).toBeNull();
				expect(response.body.failure.phase).toBe('radar_fetch');
			});
	});

	it('should hide API docs comparison snapshot internal errors', async () => {
		getApiDocsComparisonSnapshot.execute.mockResolvedValue(
			err(new Error('boom'))
		);

		await request(app)
			.get('/cross-check/api-docs/latest')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});

function createApiDocsSnapshotList(): CrossCheckApiDocsComparisonSnapshotListDTO {
	return {
		count: 2,
		generatedAt: '2026-07-03T12:06:00.000Z',
		limit: 2,
		snapshots: [
			{
				comparisonSummary: {
					fieldMismatchCount: 0,
					matchedCount: 1,
					sourceMissingCount: 0,
					stellarAtlasMissingCount: 0,
					totalCount: 1
				},
				failure: null,
				generatedAt: '2026-07-03T12:05:00.000Z',
				id: 'snapshot-2',
				status: 'compared',
				storedAt: '2026-07-03T12:05:01.000Z'
			},
			{
				comparisonSummary: null,
				failure: createFailure(),
				generatedAt: '2026-07-03T12:00:00.000Z',
				id: 'snapshot-failed-1',
				status: 'failed',
				storedAt: '2026-07-03T12:00:01.000Z'
			}
		]
	};
}

function createApiDocsSnapshot(): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	return {
		comparison: {
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T12:00:00.000Z',
			operations: [
				{
					comparisonStatus: 'matched',
					fieldMismatches: [],
					key: { method: 'get', path: '/v1' },
					source: createOperation(),
					stellarAtlas: createOperation()
				}
			],
			source: {
				documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
				observedAt: '2026-07-03T11:59:00.000Z',
				operationCount: 1,
				sourceId: 'withobsrvr-radar',
				title: 'RADAR API',
				version: '1.0.0'
			},
			stellarAtlas: {
				documentationUrl: '/docs',
				observedAt: '2026-07-03T12:00:00.000Z',
				operationCount: 1,
				sourceId: 'stellaratlas-api',
				title: 'StellarAtlas.io API',
				version: 'v1'
			},
			summary: {
				fieldMismatchCount: 0,
				matchedCount: 1,
				sourceMissingCount: 0,
				stellarAtlasMissingCount: 0,
				totalCount: 1
			}
		},
		failure: null,
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-1',
		status: 'compared',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}

function createFailedApiDocsSnapshot(): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	return {
		comparison: null,
		failure: createFailure(),
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-failed-1',
		status: 'failed',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}

function createOperation() {
	return {
		method: 'get' as const,
		operationId: 'getNetwork',
		path: '/v1',
		schemaRefs: ['#/definitions/Network'],
		summary: 'Get network information',
		tags: ['Network']
	};
}

function createFailure() {
	return {
		kind: 'timeout',
		message: 'RADAR API docs request timed out',
		occurredAt: '2026-07-03T12:00:00.000Z',
		phase: 'radar_fetch' as const,
		sourceId: 'withobsrvr-radar' as const
	};
}
