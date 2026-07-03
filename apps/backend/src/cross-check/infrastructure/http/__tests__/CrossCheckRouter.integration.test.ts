import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { CrossCheckRouterWrapper } from '../CrossCheckRouter.js';

describe('CrossCheckRouter.integration', () => {
	let app: express.Application;
	let getCrossCheckArchives: jest.Mocked<GetCrossCheckArchives>;
	let getCrossCheckSources: jest.Mocked<GetCrossCheckSources>;
	let getCrossCheckValidators: jest.Mocked<GetCrossCheckValidators>;

	beforeEach(() => {
		getCrossCheckArchives = mock<GetCrossCheckArchives>();
		getCrossCheckSources = mock<GetCrossCheckSources>();
		getCrossCheckValidators = mock<GetCrossCheckValidators>();
		app = express();
		app.use(
			'/cross-check',
			CrossCheckRouterWrapper({
				getCrossCheckArchives,
				getCrossCheckSources,
				getCrossCheckValidators
			})
		);
	});

	it('should expose validator cross-check review rows', async () => {
		getCrossCheckValidators.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				limit: 10,
				count: 1,
				totalEligibleCount: 1,
				probe: 'not_run',
				comparisonStatus: 'not_compared',
				evidenceSelection:
					'latest_network_snapshot_validator_or_validating_or_active_in_scp',
				validators: [
					{
						publicKey: 'GA',
						comparisonStatus: 'not_compared',
						stellarAtlas: {
							active: true,
							activeInScp: true,
							alias: null,
							connectivityError: false,
							historyArchiveHasError: false,
							historyUrl: 'https://history.example.com',
							homeDomain: 'example.com',
							host: 'core-live.example.com',
							inclusionReasons: ['is_validating', 'active_in_scp'],
							index: 1,
							isFullValidator: true,
							isValidating: true,
							isValidator: false,
							lag: null,
							name: 'Example Validator',
							organizationId: 'org-1',
							publicKey: 'GA',
							quorumSetHashKey: 'hash',
							stellarCoreVersionBehind: false,
							validatorEvidenceStatus: 'validating_observed',
							versionStr: 'stellar-core 23.0.0'
						},
						radarComparison: {
							comparisonStatus: 'not_compared',
							probe: 'not_run',
							sourceId: 'withobsrvr-radar'
						}
					}
				]
			})
		);

		await request(app)
			.get('/cross-check/validators?limit=10')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
				expect(response.body.comparisonStatus).toBe('not_compared');
				expect(response.body.validators[0].comparisonStatus).toBe(
					'not_compared'
				);
			});
		expect(getCrossCheckValidators.execute).toHaveBeenCalledWith({ limit: 10 });
	});

	it.each(['0', '101', '1.5'])(
		'should reject invalid validator cross-check limit %s',
		async (limit) => {
			await request(app)
				.get('/cross-check/validators?limit=' + limit)
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toHaveLength(1);
				});
		}
	);

	it('should expose archive cross-check review rows', async () => {
		getCrossCheckArchives.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				limit: 10,
				count: 1,
				probe: 'not_run',
				comparisonStatus: 'not_compared',
				evidenceSelection: 'latest_verification_scan_preferred',
				archives: [
					{
						archiveUrl: 'https://history.example.com',
						comparisonStatus: 'not_compared',
						stellarAtlas: {
							archiveEvidenceStatus: 'archive_verification_error',
							archiveVerificationErrorCount: 1,
							archiveVerificationErrors: [
								{
									message: 'Wrong ledger hash',
									url: 'https://history.example.com/ledger.xdr.gz'
								}
							],
							hasArchiveVerificationError: true,
							hasWorkerIssue: false,
							isSlowArchive: false,
							latestVerifiedLedger: 127,
							scanCompletedAt: '2026-07-03T10:05:00.000Z',
							scanStartedAt: '2026-07-03T10:00:00.000Z',
							workerEvidenceStatus: 'no_worker_issue_observed',
							workerIssueCount: 0,
							workerIssues: []
						},
						radarComparison: {
							comparisonStatus: 'not_compared',
							probe: 'not_run',
							sourceId: 'withobsrvr-radar'
						}
					}
				]
			})
		);

		await request(app)
			.get('/cross-check/archives?limit=10')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
				expect(response.body.comparisonStatus).toBe('not_compared');
				expect(response.body.archives[0].comparisonStatus).toBe('not_compared');
			});
		expect(getCrossCheckArchives.execute).toHaveBeenCalledWith({ limit: 10 });
	});

	it('should reject invalid archive cross-check limits', async () => {
		await request(app)
			.get('/cross-check/archives?limit=0')
			.expect(400)
			.expect((response) => {
				expect(response.body.errors).toHaveLength(1);
			});
	});

	it('should expose configured cross-check sources', async () => {
		getCrossCheckSources.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				probe: 'not_run',
				sources: [
					{
						description: 'Current StellarAtlas API',
						documentationUrl: '/docs',
						id: 'stellaratlas-api',
						kind: 'internal',
						name: 'StellarAtlas Public API',
						probe: 'not_run',
						scopes: ['validators', 'organizations', 'archives'],
						url: '/v1'
					}
				]
			})
		);

		await request(app)
			.get('/cross-check/sources')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=300')
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
				expect(response.body.sources[0].id).toBe('stellaratlas-api');
			});
	});

	it('should hide internal errors', async () => {
		getCrossCheckSources.execute.mockReturnValue(err(new Error('boom')));

		await request(app)
			.get('/cross-check/sources')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});

	it('should hide archive cross-check internal errors', async () => {
		getCrossCheckArchives.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/cross-check/archives')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});

	it('should hide validator cross-check internal errors', async () => {
		getCrossCheckValidators.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/cross-check/validators')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});
