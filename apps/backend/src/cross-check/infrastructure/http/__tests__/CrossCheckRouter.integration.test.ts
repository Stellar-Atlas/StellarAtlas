import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetRadarNetworkComparisonSnapshot } from '@cross-check/use-cases/get-radar-network-comparison-snapshot/GetRadarNetworkComparisonSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '@cross-check/use-cases/list-api-docs-comparison-snapshots/ListApiDocsComparisonSnapshots.js';
import { ListRadarNetworkComparisonSnapshots } from '@cross-check/use-cases/list-radar-network-comparison-snapshots/ListRadarNetworkComparisonSnapshots.js';
import { CrossCheckRouterWrapper } from '../CrossCheckRouter.js';

describe('CrossCheckRouter.integration', () => {
	let app: express.Application;
	let getApiDocsComparisonSnapshot: jest.Mocked<GetApiDocsComparisonSnapshot>;
	let getCrossCheckArchives: jest.Mocked<GetCrossCheckArchives>;
	let getCrossCheckOrganizations: jest.Mocked<GetCrossCheckOrganizations>;
	let getCrossCheckSources: jest.Mocked<GetCrossCheckSources>;
	let getCrossCheckValidators: jest.Mocked<GetCrossCheckValidators>;
	let getRadarNetworkComparisonSnapshot: jest.Mocked<GetRadarNetworkComparisonSnapshot>;
	let listApiDocsComparisonSnapshots: jest.Mocked<ListApiDocsComparisonSnapshots>;
	let listRadarNetworkComparisonSnapshots: jest.Mocked<ListRadarNetworkComparisonSnapshots>;

	beforeEach(() => {
		getApiDocsComparisonSnapshot = mock<GetApiDocsComparisonSnapshot>();
		getCrossCheckArchives = mock<GetCrossCheckArchives>();
		getCrossCheckOrganizations = mock<GetCrossCheckOrganizations>();
		getCrossCheckSources = mock<GetCrossCheckSources>();
		getCrossCheckValidators = mock<GetCrossCheckValidators>();
		getRadarNetworkComparisonSnapshot =
			mock<GetRadarNetworkComparisonSnapshot>();
		listApiDocsComparisonSnapshots = mock<ListApiDocsComparisonSnapshots>();
		listRadarNetworkComparisonSnapshots =
			mock<ListRadarNetworkComparisonSnapshots>();
		app = express();
		app.use(
			'/cross-check',
			CrossCheckRouterWrapper({
				getApiDocsComparisonSnapshot,
				getCrossCheckArchives,
				getCrossCheckOrganizations,
				getCrossCheckSources,
				getCrossCheckValidators,
				getRadarNetworkComparisonSnapshot,
				listApiDocsComparisonSnapshots,
				listRadarNetworkComparisonSnapshots
			})
		);
	});

	it('should expose organization cross-check review rows', async () => {
		getCrossCheckOrganizations.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				limit: 10,
				count: 1,
				totalEligibleCount: 1,
				probe: 'not_run',
				comparisonStatus: 'not_compared',
				evidenceSelection: 'latest_network_snapshot_active_organizations',
				organizations: [
					{
						organizationId: 'org-1',
						comparisonStatus: 'not_compared',
						stellarAtlas: {
							dateDiscovered: '2026-07-03T00:00:00.000Z',
							dba: null,
							description: 'Example operator',
							github: null,
							has24HourStats: true,
							has30DayStats: true,
							hasReliableUptime: true,
							homeDomain: 'example.com',
							horizonUrl: 'https://horizon.example.com',
							id: 'org-1',
							keybase: null,
							name: 'Example Org',
							officialEmail: 'ops@example.com',
							organizationEvidenceStatus: 'organization_snapshot_observed',
							organizationId: 'org-1',
							phoneNumber: null,
							physicalAddress: null,
							subQuorum24HoursAvailability: 1,
							subQuorum30DaysAvailability: 1,
							subQuorumAvailable: true,
							tomlEvidenceStatus: 'toml_ok',
							tomlState: 'Ok',
							twitter: null,
							url: 'https://example.com',
							validatorPublicKeyCount: 2,
							validatorPublicKeys: ['GA', 'GB']
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
			.get('/cross-check/organizations?limit=10')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
				expect(response.body.comparisonStatus).toBe('not_compared');
				expect(response.body.organizations[0].comparisonStatus).toBe(
					'not_compared'
				);
			});
		expect(getCrossCheckOrganizations.execute).toHaveBeenCalledWith({
			limit: 10
		});
	});

	it.each(['0', '101', '1.5'])(
		'should reject invalid organization cross-check limit %s',
		async (limit) => {
			await request(app)
				.get('/cross-check/organizations?limit=' + limit)
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toHaveLength(1);
				});
		}
	);

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

	it('should hide organization cross-check internal errors', async () => {
		getCrossCheckOrganizations.execute.mockResolvedValue(
			err(new Error('boom'))
		);

		await request(app)
			.get('/cross-check/organizations')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});
