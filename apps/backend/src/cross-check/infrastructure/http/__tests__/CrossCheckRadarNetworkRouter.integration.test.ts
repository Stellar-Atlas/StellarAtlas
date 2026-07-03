import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { CrossCheckRadarNetworkComparisonSnapshotRecordDTO } from '@cross-check/domain/CrossCheckRadarNetworkSnapshot.js';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetRadarNetworkComparisonSnapshot } from '@cross-check/use-cases/get-radar-network-comparison-snapshot/GetRadarNetworkComparisonSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '@cross-check/use-cases/list-api-docs-comparison-snapshots/ListApiDocsComparisonSnapshots.js';
import { CrossCheckRouterWrapper } from '../CrossCheckRouter.js';

describe('CrossCheckRadarNetworkRouter.integration', () => {
	let app: express.Application;
	let getRadarNetworkComparisonSnapshot: jest.Mocked<GetRadarNetworkComparisonSnapshot>;

	beforeEach(() => {
		getRadarNetworkComparisonSnapshot =
			mock<GetRadarNetworkComparisonSnapshot>();
		app = express();
		app.use(
			'/cross-check',
			CrossCheckRouterWrapper({
				getApiDocsComparisonSnapshot: mock<GetApiDocsComparisonSnapshot>(),
				getCrossCheckArchives: mock<GetCrossCheckArchives>(),
				getCrossCheckOrganizations: mock<GetCrossCheckOrganizations>(),
				getCrossCheckSources: mock<GetCrossCheckSources>(),
				getCrossCheckValidators: mock<GetCrossCheckValidators>(),
				getRadarNetworkComparisonSnapshot,
				listApiDocsComparisonSnapshots: mock<ListApiDocsComparisonSnapshots>()
			})
		);
	});

	it('should expose the latest persisted RADAR network comparison snapshot', async () => {
		getRadarNetworkComparisonSnapshot.execute.mockResolvedValue(
			ok(createRadarNetworkSnapshot())
		);

		await request(app)
			.get('/cross-check/radar-network/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.body.status).toBe('compared');
				expect(response.body.comparison.summary.totalCount).toBe(1);
				expect(response.body.comparison.validators[0].comparisonStatus).toBe(
					'matched'
				);
			});
		expect(getRadarNetworkComparisonSnapshot.execute).toHaveBeenCalledTimes(1);
	});

	it('should return 204 when no RADAR network comparison snapshot exists', async () => {
		getRadarNetworkComparisonSnapshot.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/cross-check/radar-network/latest')
			.expect(204)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.text).toBe('');
			});
	});

	it('should expose persisted RADAR network comparison failure snapshots', async () => {
		getRadarNetworkComparisonSnapshot.execute.mockResolvedValue(
			ok(createFailedRadarNetworkSnapshot())
		);

		await request(app)
			.get('/cross-check/radar-network/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=60')
			.expect((response) => {
				expect(response.body.status).toBe('failed');
				expect(response.body.comparison).toBeNull();
				expect(response.body.failure.phase).toBe('radar_fetch');
			});
	});

	it('should hide RADAR network comparison snapshot internal errors', async () => {
		getRadarNetworkComparisonSnapshot.execute.mockResolvedValue(
			err(new Error('boom'))
		);

		await request(app)
			.get('/cross-check/radar-network/latest')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});

function createRadarNetworkSnapshot(): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
	return {
		comparison: {
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T12:00:00.000Z',
			organizations: [],
			source: {
				endpointUrl: 'https://radar.withobsrvr.com/api/v1',
				latestLedger: '63311161',
				networkId: 'public',
				networkName: 'Public Stellar Network',
				networkTime: '2026-07-03T11:59:00.000Z',
				observedAt: '2026-07-03T11:59:30.000Z',
				organizationCount: 0,
				sourceId: 'withobsrvr-radar',
				validatorCount: 1,
				warnings: []
			},
			stellarAtlas: {
				observedAt: '2026-07-03T12:00:00.000Z',
				organizationCount: 0,
				sourceId: 'stellaratlas-api',
				validatorCount: 1
			},
			summary: {
				fieldMismatchCount: 0,
				matchedCount: 1,
				organizationCount: 0,
				sourceMissingCount: 0,
				stellarAtlasMissingCount: 0,
				totalCount: 1,
				validatorCount: 1
			},
			validators: [
				{
					comparisonStatus: 'matched',
					entityType: 'validator',
					fieldMismatches: [],
					key: 'GA',
					source: createRadarNode(),
					stellarAtlas: createStellarAtlasValidator()
				}
			],
			warnings: []
		},
		failure: null,
		generatedAt: '2026-07-03T12:00:00.000Z',
		id: 'snapshot-1',
		status: 'compared',
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}

function createFailedRadarNetworkSnapshot(): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
	return {
		comparison: null,
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

function createRadarNode() {
	return {
		active: true,
		activeInScp: true,
		alias: 'radar-validator',
		connectivityError: false,
		historyArchiveHasError: false,
		historyUrl: 'https://history.example.com',
		homeDomain: 'example.com',
		host: 'core-live.example.com',
		index: 1,
		isFullValidator: true,
		isValidating: true,
		isValidator: true,
		lag: null,
		name: 'Example Validator',
		organizationId: 'org-1',
		publicKey: 'GA',
		quorumSetHashKey: 'hash',
		stellarCoreVersionBehind: false,
		versionStr: 'stellar-core 23.0.0'
	};
}

function createStellarAtlasValidator() {
	return {
		active: true,
		activeInScp: true,
		alias: 'radar-validator',
		connectivityError: false,
		historyArchiveHasError: false,
		historyUrl: 'https://history.example.com',
		homeDomain: 'example.com',
		host: 'core-live.example.com',
		inclusionReasons: ['is_validator' as const],
		index: 1,
		isFullValidator: true,
		isValidating: true,
		isValidator: true,
		lag: null,
		name: 'Example Validator',
		organizationId: 'org-1',
		publicKey: 'GA',
		quorumSetHashKey: 'hash',
		stellarCoreVersionBehind: false,
		validatorEvidenceStatus: 'validator_identity_observed' as const,
		versionStr: 'stellar-core 23.0.0'
	};
}
