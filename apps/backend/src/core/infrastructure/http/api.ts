import swaggerUi from 'swagger-ui-express';
import express from 'express';
import Kernel from '../Kernel.js';
import { DataSource } from 'typeorm';
import { Config, getConfigFromEnv } from '../../config/Config.js';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import { subscriptionRouter } from '@notifications/infrastructure/http/SubscriptionRouter.js';
import bodyParser from 'body-parser';
import { Server } from 'http';
import type { Socket } from 'net';
import swaggerDocument from '../../../../openapi.json' with { type: 'json' };
import { ConfirmSubscription } from '@notifications/use-cases/confirm-subscription/ConfirmSubscription.js';
import { Subscribe } from '@notifications/use-cases/subscribe/Subscribe.js';
import { UnmuteNotification } from '@notifications/use-cases/unmute-notification/UnmuteNotification.js';
import { Unsubscribe } from '@notifications/use-cases/unsubscribe/Unsubscribe.js';
import { networkRouter } from '@network-scan/infrastructure/http/NetworkRouter.js';
import { knownNetworkRouter } from '@network-scan/infrastructure/http/KnownNetworkRouter.js';
import { attachNetworkLiveWebSocket } from '@network-scan/infrastructure/http/NetworkLiveWebSocket.js';
import helmet from 'helmet';
import { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';
import { GetLatestNodeSnapshots } from '@network-scan/use-cases/get-latest-node-snapshots/GetLatestNodeSnapshots.js';
import { GetLatestOrganizationSnapshots } from '@network-scan/use-cases/get-latest-organization-snapshots/GetLatestOrganizationSnapshots.js';
import { GetKnownNode } from '@network-scan/use-cases/get-known-node/GetKnownNode.js';
import { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';
import { nodeRouter } from '@network-scan/infrastructure/http/NodeRouter.js';
import { organizationRouter } from '@network-scan/infrastructure/http/OrganizationRouter.js';
import { GetNode } from '@network-scan/use-cases/get-node/GetNode.js';
import { GetNodes } from '@network-scan/use-cases/get-nodes/GetNodes.js';
import { GetNodeSnapshots } from '@network-scan/use-cases/get-node-snapshots/GetNodeSnapshots.js';
import { GetOrganizationSnapshots } from '@network-scan/use-cases/get-organization-snapshots/GetOrganizationSnapshots.js';
import { GetOrganization } from '@network-scan/use-cases/get-organization/GetOrganization.js';
import { GetOrganizations } from '@network-scan/use-cases/get-organizations/GetOrganizations.js';
import { GetMeasurementsFactory } from '@network-scan/use-cases/get-measurements/GetMeasurementsFactory.js';
import { GetMeasurementAggregations } from '@network-scan/use-cases/get-measurement-aggregations/GetMeasurementAggregations.js';
import { GetScpStatements } from '@network-scan/use-cases/get-scp-statements/GetScpStatements.js';
import { GetLatestObservedLedger } from '@network-scan/use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { RequestUnsubscribeLink } from '@notifications/use-cases/request-unsubscribe-link/RequestUnsubscribeLink.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';
import { RegisterParsedLedgerHeaders } from '@history-scan-coordinator/use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import { RegisterParsedTransactionEnvelopes } from '@history-scan-coordinator/use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '@history-scan-coordinator/use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import { BackfillArchiveMetadata } from '@history-scan-coordinator/use-cases/backfill-archive-metadata/BackfillArchiveMetadata.js';
import { historyScanRouter } from '@history-scan-coordinator/infrastructure/http/HistoryScanRouter.js';
import { archiveScanRouter } from '@history-scan-coordinator/infrastructure/http/ArchiveScanRouter.js';
import { archiveEvidenceRouter } from '@history-scan-coordinator/infrastructure/http/ArchiveEvidenceRouter.js';
import { communityScannerRouter } from '@history-scan-coordinator/infrastructure/http/CommunityScannerRouter.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { ReleaseScanJob } from '@history-scan-coordinator/use-cases/release-scan-job/ReleaseScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetScanEvidence } from '@history-scan-coordinator/use-cases/get-scan-evidence/GetScanEvidence.js';
import { GetHistoryArchiveState } from '@history-scan-coordinator/use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { GetHistoryArchiveObjects } from '@history-scan-coordinator/use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import { GetHistoryArchiveBucketCoverage } from '@history-scan-coordinator/use-cases/get-history-archive-bucket-coverage/GetHistoryArchiveBucketCoverage.js';
import { GetHistoryArchiveObjectSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveObjectStatusSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-status-summary/GetHistoryArchiveObjectStatusSummary.js';
import { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { GetHistoryArchiveRepairPlan } from '@history-scan-coordinator/use-cases/get-history-archive-repair-plan/GetHistoryArchiveRepairPlan.js';
import { GetHistoryArchiveEvidence } from '@history-scan-coordinator/use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import { GetKnownNodeArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-node-archive-evidence/GetKnownNodeArchiveEvidence.js';
import { GetKnownOrganizationArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-organization-archive-evidence/GetKnownOrganizationArchiveEvidence.js';
import { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetHistoryArchiveObjectJob } from '@history-scan-coordinator/use-cases/get-history-archive-object-job/GetHistoryArchiveObjectJob.js';
import { TouchHistoryArchiveObject } from '@history-scan-coordinator/use-cases/touch-history-archive-object/TouchHistoryArchiveObject.js';
import { CompleteHistoryArchiveObject } from '@history-scan-coordinator/use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '@history-scan-coordinator/use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReleaseHistoryArchiveObject } from '@history-scan-coordinator/use-cases/release-history-archive-object/ReleaseHistoryArchiveObject.js';
import { ReportHistoryArchiveWorkerStatus } from '@history-scan-coordinator/use-cases/report-history-archive-worker-status/ReportHistoryArchiveWorkerStatus.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { RegisterCommunityScanner } from '@history-scan-coordinator/use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '@history-scan-coordinator/use-cases/SendScannerHeartbeat.js';
import { statusRouter } from '@status/infrastructure/http/StatusRouter.js';
import { attachStatusLiveWebSocket } from '@status/infrastructure/http/StatusLiveWebSocket.js';
import { fullHistoryRouter } from '@status/infrastructure/http/FullHistoryRouter.js';
import { GetArchiveQueueStatus } from '@status/use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '@status/use-cases/get-api-status/GetApiStatus.js';
import { GetDataQualityStatus } from '@status/use-cases/get-data-quality-status/GetDataQualityStatus.js';
import { GetDataFreshnessStatus } from '@status/use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetFullHistoryStatus } from '@status/use-cases/get-full-history-status/GetFullHistoryStatus.js';
import { GetRollupStatus } from '@status/use-cases/get-rollup-status/GetRollupStatus.js';
import { GetScanLogStatus } from '@status/use-cases/get-scan-log-status/GetScanLogStatus.js';
import { GetScanStatus } from '@status/use-cases/get-scan-status/GetScanStatus.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '@status/use-cases/get-service-status/GetServiceStatus.js';
import { GetStatus } from '@status/use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '@status/use-cases/get-worker-status/GetWorkerStatus.js';
import { crossCheckRouter } from '@cross-check/infrastructure/http/CrossCheckRouter.js';
import { GetApiDocsComparisonSnapshot } from '@cross-check/use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { GetCrossCheckArchives } from '@cross-check/use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '@cross-check/use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '@cross-check/use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '@cross-check/use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import { GetRadarNetworkComparisonSnapshot } from '@cross-check/use-cases/get-radar-network-comparison-snapshot/GetRadarNetworkComparisonSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '@cross-check/use-cases/list-api-docs-comparison-snapshots/ListApiDocsComparisonSnapshots.js';
import { ListRadarNetworkComparisonSnapshots } from '@cross-check/use-cases/list-radar-network-comparison-snapshots/ListRadarNetworkComparisonSnapshots.js';
import { fbasRouter } from '@fbas/infrastructure/http/FbasRouter.js';
import { GetFbasAnalysisProof } from '@fbas/use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetFbasAnalysis } from '@fbas/use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbasProofSets } from '@fbas/use-cases/get-latest-fbas-proof-sets/GetLatestFbasProofSets.js';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '@fbas/use-cases/get-top-tier-history/GetTopTierHistory.js';
import { frontendV4ProxyMiddleware } from './FrontendV4Proxy.js';
import { mountExplorerRoutes } from './ExplorerRoutes.js';
import { swaggerDocsOptions } from './SwaggerDocsOptions.js';

let server: Server;
const serverSockets = new Set<Socket>();
let shutdownStarted = false;
const api = express();
api.use(corsMiddleware);
api.use('/v1/history-scan', bodyParser.json({ limit: '2mb' }));
api.use(bodyParser.json());
api.use(frontendV4ProxyMiddleware);
api.use(helmet());
api.set('trust proxy', true); //todo: env var

const setup = async (): Promise<{ config: Config; kernel: Kernel }> => {
	const configResult = getConfigFromEnv();
	if (configResult.isErr()) {
		console.log('Invalid configuration');
		console.log(configResult.error.message);
		throw new Error('Invalid configuration');
	}

	const config = configResult.value;
	const kernel = await Kernel.getInstance(config);

	return {
		config: config,
		kernel: kernel
	};
};
const listen = async () => {
	const { config, kernel } = await setup();
	const exceptionLogger =
		kernel.container.get<ExceptionLogger>('ExceptionLogger');

	api.get(
		'/docs',
		async (req: express.Request, res: express.Response, next) => {
			res.set('Content-Security-Policy', "frame-src 'self'");
			next();
		}
	);
	api.use(
		'/docs',
		swaggerUi.serve,
		swaggerUi.setup(swaggerDocument, swaggerDocsOptions)
	);

	api.use(
		'/v1/subscription',
		subscriptionRouter({
			exceptionLogger: exceptionLogger,
			confirmSubscription: kernel.container.get(ConfirmSubscription),
			subscribe: kernel.container.get(Subscribe),
			unmuteNotification: kernel.container.get(UnmuteNotification),
			unsubscribe: kernel.container.get(Unsubscribe),
			requestUnsubscribeLink: kernel.container.get(RequestUnsubscribeLink)
		})
	);

	api.use(
		'/v1/archive-scans',
		archiveScanRouter({
			getArchiveScans: kernel.container.get(GetArchiveScans),
			getArchiveScanQueue: kernel.container.get(GetArchiveScanQueue),
			getArchiveScanWorkers: kernel.container.get(GetArchiveScanWorkers),
			getHistoryArchiveBucketCoverage: kernel.container.get(
				GetHistoryArchiveBucketCoverage
			),
			getHistoryArchiveObjectEvents: kernel.container.get(
				GetHistoryArchiveObjectEvents
			),
			getHistoryArchiveObjects: kernel.container.get(GetHistoryArchiveObjects),
			getHistoryArchiveObjectSummary: kernel.container.get(
				GetHistoryArchiveObjectSummary
			),
			getHistoryArchiveObjectStatusSummary: kernel.container.get(
				GetHistoryArchiveObjectStatusSummary
			),
			getHistoryArchiveRepairPlan: kernel.container.get(
				GetHistoryArchiveRepairPlan
			),
			getHistoryArchiveState: kernel.container.get(GetHistoryArchiveState),
			getLatestScan: kernel.container.get(GetLatestScan),
			getScanEvidence: kernel.container.get(GetScanEvidence),
			getScanLogs: kernel.container.get(GetScanLogs)
		})
	);

	api.use(
		'/v2/archive-scans',
		archiveEvidenceRouter({
			getHistoryArchiveEvidence: kernel.container.get(GetHistoryArchiveEvidence)
		})
	);

	api.use(
		'/v1/community-scanners',
		communityScannerRouter({
			registerCommunityScanner: kernel.container.get(RegisterCommunityScanner),
			sendScannerHeartbeat: kernel.container.get(SendScannerHeartbeat),
			getScannerMetrics: kernel.container.get(GetScannerMetrics),
			getScanJob: kernel.container.get(GetScanJob),
			touchScanJob: kernel.container.get(TouchScanJob),
			registerScan: kernel.container.get(RegisterScan),
			frontendBaseUrl: config.frontendBaseUrl,
			frontendRevalidateToken: config.frontendRevalidateToken
		})
	);

	api.use(
		'/v1/status',
		statusRouter({
			getStatus: kernel.container.get(GetStatus),
			getApiStatus: kernel.container.get(GetApiStatus),
			getDataQualityStatus: kernel.container.get(GetDataQualityStatus),
			getDataFreshnessStatus: kernel.container.get(GetDataFreshnessStatus),
			getScanLogStatus: kernel.container.get(GetScanLogStatus),
			getScanStatus: kernel.container.get(GetScanStatus),
			getRollupStatus: kernel.container.get(GetRollupStatus),
			getFrontendStatus: kernel.container.get(GetFrontendStatus),
			getHorizonStatus: kernel.container.get(GetHorizonStatus),
			getRpcStatus: kernel.container.get(GetRpcStatus),
			getFailoverStatus: kernel.container.get(GetFailoverStatus),
			getArchiveQueueStatus: kernel.container.get(GetArchiveQueueStatus),
			getWorkerStatus: kernel.container.get(GetWorkerStatus)
		})
	);

	api.use(
		'/v1',
		fullHistoryRouter({
			getFullHistoryStatus: kernel.container.get(GetFullHistoryStatus)
		})
	);

	api.use(
		'/v1/cross-check',
		crossCheckRouter({
			getApiDocsComparisonSnapshot: kernel.container.get(
				GetApiDocsComparisonSnapshot
			),
			getCrossCheckArchives: kernel.container.get(GetCrossCheckArchives),
			getCrossCheckOrganizations: kernel.container.get(
				GetCrossCheckOrganizations
			),
			getCrossCheckSources: kernel.container.get(GetCrossCheckSources),
			getCrossCheckValidators: kernel.container.get(GetCrossCheckValidators),
			getRadarNetworkComparisonSnapshot: kernel.container.get(
				GetRadarNetworkComparisonSnapshot
			),
			listApiDocsComparisonSnapshots: kernel.container.get(
				ListApiDocsComparisonSnapshots
			),
			listRadarNetworkComparisonSnapshots: kernel.container.get(
				ListRadarNetworkComparisonSnapshots
			)
		})
	);

	api.use(
		'/v1/fbas',
		fbasRouter({
			getFbasAnalysis: kernel.container.get(GetFbasAnalysis),
			getFbasAnalysisProof: kernel.container.get(GetFbasAnalysisProof),
			getLatestFbasProofSets: kernel.container.get(GetLatestFbasProofSets),
			getLatestFbas: kernel.container.get(GetLatestFbas),
			getTopTierHistory: kernel.container.get(GetTopTierHistory)
		})
	);

	api.use(
		'/v1/history-scan',
		historyScanRouter({
			getLatestScan: kernel.container.get(GetLatestScan),
			getScanLogs: kernel.container.get(GetScanLogs),
			registerParsedLedgerHeaders: kernel.container.get(
				RegisterParsedLedgerHeaders
			),
			registerParsedTransactionEnvelopes: kernel.container.get(
				RegisterParsedTransactionEnvelopes
			),
			registerParsedTransactionResults: kernel.container.get(
				RegisterParsedTransactionResults
			),
			getHistoryArchiveObjectJob: kernel.container.get(
				GetHistoryArchiveObjectJob
			),
			touchHistoryArchiveObject: kernel.container.get(
				TouchHistoryArchiveObject
			),
			completeHistoryArchiveObject: kernel.container.get(
				CompleteHistoryArchiveObject
			),
			failHistoryArchiveObject: kernel.container.get(FailHistoryArchiveObject),
			releaseHistoryArchiveObject: kernel.container.get(
				ReleaseHistoryArchiveObject
			),
			reportHistoryArchiveWorkerStatus: kernel.container.get(
				ReportHistoryArchiveWorkerStatus
			),
			registerScan: kernel.container.get(RegisterScan),
			userName: config.historyScanAPIUsername,
			password: config.historyScanAPIPassword,
			frontendBaseUrl: config.frontendBaseUrl,
			frontendRevalidateToken: config.frontendRevalidateToken,
			getScanJob: kernel.container.get(GetScanJob),
			releaseScanJob: kernel.container.get(ReleaseScanJob),
			touchScanJob: kernel.container.get(TouchScanJob),
			backfillArchiveMetadata: kernel.container.get(BackfillArchiveMetadata)
		})
	);

	api.use(function (req, res, next) {
		if (req.url.match(/^\/$/) || req.url.match('/v2/all')) {
			res.redirect(301, '/v1');
		}
		next();
	});

	api.use(
		'/v1/known',
		knownNetworkRouter({
			getKnownNode: kernel.container.get(GetKnownNode),
			getKnownNodeArchiveEvidence: kernel.container.get(
				GetKnownNodeArchiveEvidence
			),
			getKnownNodes: kernel.container.get(GetKnownNodes),
			getKnownOrganization: kernel.container.get(GetKnownOrganization),
			getKnownOrganizationArchiveEvidence: kernel.container.get(
				GetKnownOrganizationArchiveEvidence
			),
			getKnownOrganizations: kernel.container.get(GetKnownOrganizations)
		})
	);

	mountExplorerRoutes(api, kernel, config);

	api.use(
		['/v1/node', '/v1/nodes'],
		nodeRouter({
			getNode: kernel.container.get(GetNode),
			getNodeSnapshots: kernel.container.get(GetNodeSnapshots),
			getNodes: kernel.container.get(GetNodes),
			getMeasurementAggregations: kernel.container.get(
				GetMeasurementAggregations
			),
			getMeasurementsFactory: kernel.container.get(GetMeasurementsFactory)
		})
	);

	api.use(
		['/v1/organization', '/v1/organizations'],
		organizationRouter({
			getOrganization: kernel.container.get(GetOrganization),
			getOrganizationSnapshots: kernel.container.get(GetOrganizationSnapshots),
			getMeasurementAggregations: kernel.container.get(
				GetMeasurementAggregations
			),
			getOrganizations: kernel.container.get(GetOrganizations),
			getMeasurementsFactory: kernel.container.get(GetMeasurementsFactory)
		})
	);

	api.use(
		'/v1',
		networkRouter({
			getNetwork: kernel.container.get(GetNetwork),
			getKnownArchiveEvidence: kernel.container.get(GetKnownArchiveEvidence),
			getKnownNodes: kernel.container.get(GetKnownNodes),
			getKnownOrganizations: kernel.container.get(GetKnownOrganizations),
			getMeasurementAggregations: kernel.container.get(
				GetMeasurementAggregations
			),
			getMeasurementsFactory: kernel.container.get(GetMeasurementsFactory),
			getLatestNodeSnapshots: kernel.container.get(GetLatestNodeSnapshots),
			getLatestOrganizationSnapshots: kernel.container.get(
				GetLatestOrganizationSnapshots
			),
			getScpStatements: kernel.container.get(GetScpStatements),
			logger: kernel.container.get<Logger>('Logger'),
			networkScanRepository: kernel.container.get<NetworkScanRepository>(
				NETWORK_TYPES.NetworkScanRepository
			),
			searchConfig: {
				apiKey: config.meilisearchApiKey,
				host: config.meilisearchHost,
				indexName: config.meilisearchNetworkIndex
			}
		})
	);

	server = api.listen(config.apiPort, () => {
		console.log('api listening on port: ' + config.apiPort);
	});
	trackServerSockets(server);
	attachNetworkLiveWebSocket(server, {
		getLatestObservedLedger: kernel.container.get(GetLatestObservedLedger),
		getNetwork: kernel.container.get(GetNetwork),
		getScpStatements: kernel.container.get(GetScpStatements),
		horizonUrl: config.horizonUrl.value,
		logger: kernel.container.get<Logger>('Logger')
	});
	attachStatusLiveWebSocket(server, {
		getApiStatus: kernel.container.get(GetApiStatus),
		getDataQualityStatus: kernel.container.get(GetDataQualityStatus),
		getFrontendStatus: kernel.container.get(GetFrontendStatus),
		getFullHistoryStatus: kernel.container.get(GetFullHistoryStatus),
		getHistoryArchiveObjectEvents: kernel.container.get(
			GetHistoryArchiveObjectEvents
		),
		getHistoryArchiveObjectSummary: kernel.container.get(
			GetHistoryArchiveObjectStatusSummary
		),
		getScanLogStatus: kernel.container.get(GetScanLogStatus),
		getWorkerStatus: kernel.container.get(GetWorkerStatus),
		logger: kernel.container.get<Logger>('Logger')
	});

	const shutdown = (signal: NodeJS.Signals): void => {
		if (shutdownStarted) return;
		shutdownStarted = true;
		console.log(`${signal} signal received: closing HTTP server`);
		void stop(kernel.container.get(DataSource)).catch((error: unknown) => {
			console.error('API shutdown failed', error);
			process.exit(1);
		});
	};

	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);
};

listen();

function corsMiddleware(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
): void {
	res.header('Access-Control-Allow-Origin', '*');
	res.header(
		'Access-Control-Allow-Headers',
		'Origin, X-Requested-With, Content-Type, Accept, Authorization'
	);
	res.header(
		'Access-Control-Allow-Methods',
		'GET, POST, PUT, PATCH, DELETE, OPTIONS'
	);
	if (req.method === 'OPTIONS') {
		res.sendStatus(204);
		return;
	}
	next();
}

function trackServerSockets(httpServer: Server): void {
	httpServer.on('connection', (socket) => {
		serverSockets.add(socket);
		socket.on('close', () => serverSockets.delete(socket));
	});
}

async function stop(dataSource: DataSource): Promise<void> {
	const forceCloseTimeout = setTimeout(() => {
		for (const socket of serverSockets) socket.destroy();
	}, 2_000);
	forceCloseTimeout.unref();

	await new Promise<void>((resolve, reject) => {
		server.close((error?: Error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
		server.closeIdleConnections();
	});

	clearTimeout(forceCloseTimeout);
	console.log('HTTP server closed');
	if (dataSource.isInitialized) await dataSource.destroy();
	console.log('connection to db closed');
	process.exit(0);
}
