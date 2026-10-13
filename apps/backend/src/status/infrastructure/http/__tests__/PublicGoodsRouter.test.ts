import express from 'express';
import request from 'supertest';
import { ok } from 'neverthrow';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type {
	HubbleCatalog,
	HubbleWarehouse
} from '../HubbleWarehouseContracts.js';
import { publicGoodsRouter } from '../PublicGoodsRouter.js';
import type { HistoryArchiveStatusSummaryV1 } from 'shared';

const now = new Date();
const current = now.toISOString();

function catalog(latestCompletedAt = current): HubbleCatalog {
	return {
		database: 'fixture',
		coverage: summarizeHubbleLedgerCoverage([]),
		datasets: [{ name: 'parsed_transactions', columns: [], rowCount: '4' }],
		generatedAt: current,
		ingestion: {
			completedBatches: '2',
			failedBatches: '0',
			latestCompletedAt,
			maximumLedger: '100',
			minimumLedger: '2',
			startedBatches: '0',
			totalRows: '4'
		},
		officialSchemaSource: 'fixture'
	};
}

function archiveSummary(
	options: {
		truncated?: boolean;
		sourceCount?: number;
		observedAt?: string;
	} = {}
): HistoryArchiveStatusSummaryV1 {
	const observedAt = options.observedAt ?? current;
	const source = {
		archiveUrl: 'https://archive.example/',
		archiveUrlIdentity: 'https://archive.example/',
		activeObjectChecks: 0,
		archiveEvidenceFailures: 0,
		currentLedger: 100,
		durableVerifiedCheckpointProofs: 1,
		latestCheckpointLedger: 63,
		latestDiscoveredCheckpointLedger: 63,
		mismatchCheckpointProofs: 0,
		notEvaluableCheckpointProofs: 0,
		objectCompleteCheckpointProofs: 1,
		observedAt,
		pendingCheckpointProofs: 0,
		rootObjectStatus: 'verified' as const,
		rootFailureChannel: null,
		scannerIssueFailures: 0,
		source: 'network-scan' as const,
		stateStatus: 'available' as const,
		stateUrl: 'https://archive.example/.well-known/stellar-history.json',
		totalCheckpointProofs: 1,
		unclassifiedFailures: 0,
		verifiedCheckpointProofs: 1
	};
	return {
		activeObjectChecks: 0,
		archiveEvidenceFailures: 0,
		canonicalProofProgress: {
			archiveUrl: source.archiveUrl,
			archiveUrlIdentity: source.archiveUrlIdentity,
			latestVerifiedCheckpointLedger: 63,
			nextCheckpointLedger: null,
			remainingCheckpoints: 0,
			targetCheckpointLedger: 63,
			totalCheckpoints: 1,
			verifiedCheckpoints: 1
		},
		checkpointCoverage:
			{} as HistoryArchiveStatusSummaryV1['checkpointCoverage'],
		generatedAt: current,
		sourceCount: options.sourceCount ?? 1,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [source],
		sourcesTruncated: options.truncated ?? false,
		transitionReconciliation: {
			oldestPendingAgeMs: null,
			oldestPendingAt: null,
			pendingTerminalEffects: 0,
			status: 'caught-up'
		},
		unclassifiedFailures: 0
	};
}

function appFor(options: {
	archive?: HistoryArchiveStatusSummaryV1;
	catalog?: HubbleCatalog;
	probeFails?: boolean;
	archiveFails?: boolean;
	catalogFails?: boolean;
}) {
	const warehouse = {
		probe: options.probeFails
			? jest.fn().mockRejectedValue(new Error('down'))
			: jest.fn().mockResolvedValue(undefined),
		catalog: options.catalogFails
			? jest.fn().mockRejectedValue(new Error('down'))
			: jest.fn().mockResolvedValue(options.catalog ?? catalog())
	} as unknown as HubbleWarehouse;
	const getArchiveStatusSummary = {
		execute: options.archiveFails
			? jest.fn().mockResolvedValue({
					isErr: () => true,
					isOk: () => false
				})
			: jest.fn().mockResolvedValue(ok(options.archive ?? archiveSummary()))
	};
	const app = express();
	app.use(
		'/v1/public-goods',
		publicGoodsRouter({
			warehouse,
			getArchiveStatusSummary: getArchiveStatusSummary as never
		})
	);
	return { app, getArchiveStatusSummary, warehouse };
}

describe('public goods health and metrics', () => {
	it('returns ready only after live and fresh checks, without cache validators', async () => {
		const { app } = appFor({});
		const response = await request(app)
			.get('/v1/public-goods/health')
			.set('If-None-Match', '"old-success"');
		expect(response.status).toBe(200);
		expect(response.body.status).toBe('ready');
		expect(response.body.checks.archive.checkedRoots).toBe(1);
		expect(response.headers.etag).toBeUndefined();
		expect(response.headers['cache-control']).toContain('no-store');
		expect(response.headers['cdn-cache-control']).toBe('no-store');
		expect(response.headers['cloudflare-cdn-cache-control']).toBe('no-store');
	});

	it('returns 503 when live ClickHouse is down or publication is stale', async () => {
		const down = await request(appFor({ probeFails: true }).app).get(
			'/v1/public-goods/health'
		);
		expect(down.status).toBe(503);
		expect(down.body.checks.clickhouse.status).toBe('unavailable');

		const staleCatalog = catalog(
			new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
		);
		const stale = await request(appFor({ catalog: staleCatalog }).app).get(
			'/v1/public-goods/health'
		);
		expect(stale.status).toBe(503);
		expect(stale.body.checks.publication.status).toBe('stale');
	});

	it('fails health closed for incomplete archive inventory and stale root observations', async () => {
		const truncated = await request(
			appFor({
				archive: archiveSummary({ truncated: true, sourceCount: 300 })
			}).app
		).get('/v1/public-goods/health');
		expect(truncated.status).toBe(503);
		expect(truncated.body.checks.archive.status).toBe('incomplete');
		expect(truncated.body.checks.archive.checkedRoots).toBeNull();

		const old = await request(
			appFor({
				archive: archiveSummary({
					observedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
				})
			}).app
		).get('/v1/public-goods/health');
		expect(old.status).toBe(503);
		expect(old.body.checks.archive.status).toBe('stale');
	});

	it('reports exact manifest counts and distinguishes configured from nonempty published datasets', async () => {
		const response = await request(appFor({}).app).get(
			'/v1/public-goods/metrics'
		);
		expect(response.status).toBe(200);
		expect(response.body.publication).toMatchObject({
			configuredDatasets: 1,
			publishedDatasets: 1,
			completedBatches: '2',
			records: '4'
		});
		expect(response.body.archives).toMatchObject({
			knownRoots: 1,
			checkedRoots: 1,
			checkedRootWindowHours: 24,
			rootObjectsVerified: 1,
			complete: true
		});
		expect(response.headers.etag).toBeUndefined();
	});

	it('uses null rather than zero for checked roots when inventory is truncated', async () => {
		const response = await request(
			appFor({
				archive: archiveSummary({ truncated: true, sourceCount: 300 })
			}).app
		).get('/v1/public-goods/metrics');
		expect(response.status).toBe(200);
		expect(response.body.archives.knownRoots).toBe(300);
		expect(response.body.archives.checkedRoots).toBeNull();
		expect(response.body.archives.complete).toBe(false);
	});

	it('returns 503 with null counts when a metrics source is unavailable', async () => {
		const response = await request(
			appFor({ catalogFails: true, archiveFails: true }).app
		).get('/v1/public-goods/metrics');
		expect(response.status).toBe(503);
		expect(response.body.publication.configuredDatasets).toBeNull();
		expect(response.body.publication.records).toBeNull();
		expect(response.body.archives.knownRoots).toBeNull();
		expect(response.body.archives.checkedRoots).toBeNull();
	});
});
