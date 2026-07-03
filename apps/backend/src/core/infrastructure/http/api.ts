import swaggerUi from 'swagger-ui-express';
import express from 'express';
import Kernel from '../Kernel.js';
import { DataSource } from 'typeorm';
import { Config, getConfigFromEnv } from '../../config/Config.js';
import type { ExceptionLogger } from 'exception-logger';
import { subscriptionRouter } from '@notifications/infrastructure/http/SubscriptionRouter.js';
import bodyParser from 'body-parser';
import { Server } from 'http';
import swaggerDocument from '../../../../openapi.json' with { type: 'json' };
import { ConfirmSubscription } from '@notifications/use-cases/confirm-subscription/ConfirmSubscription.js';
import { Subscribe } from '@notifications/use-cases/subscribe/Subscribe.js';
import { UnmuteNotification } from '@notifications/use-cases/unmute-notification/UnmuteNotification.js';
import { Unsubscribe } from '@notifications/use-cases/unsubscribe/Unsubscribe.js';
import { networkRouter } from '@network-scan/infrastructure/http/NetworkRouter.js';

import helmet from 'helmet';
import { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';
import { GetLatestNodeSnapshots } from '@network-scan/use-cases/get-latest-node-snapshots/GetLatestNodeSnapshots.js';
import { GetLatestOrganizationSnapshots } from '@network-scan/use-cases/get-latest-organization-snapshots/GetLatestOrganizationSnapshots.js';
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
import { RequestUnsubscribeLink } from '@notifications/use-cases/request-unsubscribe-link/RequestUnsubscribeLink.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';
import { historyScanRouter } from '@history-scan-coordinator/infrastructure/http/HistoryScanRouter.js';
import { archiveScanRouter } from '@history-scan-coordinator/infrastructure/http/ArchiveScanRouter.js';
import { communityScannerRouter } from '@history-scan-coordinator/infrastructure/http/CommunityScannerRouter.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { RegisterCommunityScanner } from '@history-scan-coordinator/use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '@history-scan-coordinator/use-cases/SendScannerHeartbeat.js';
import { frontendV4ProxyMiddleware } from './FrontendV4Proxy.js';

let server: Server;
const api = express();
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

	api.use(function (
		req: express.Request,
		res: express.Response,
		next: express.NextFunction
	) {
		res.header('Access-Control-Allow-Origin', '*');
		res.header(
			'Access-Control-Allow-Headers',
			'Origin, X-Requested-With, Content-Type, Accept'
		);
		res.header(
			'Access-Control-Allow-Methods',
			'GET, POST, PUT, DELETE, OPTIONS'
		);
		next();
	});

	const swaggerOptions = {
		customCss: '.swagger-ui .topbar { display: none }',
		explorer: true,
		customSiteTitle: 'StellarAtlas API doc'
	};

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
		swaggerUi.setup(swaggerDocument, swaggerOptions)
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
			getLatestScan: kernel.container.get(GetLatestScan),
			getScanLogs: kernel.container.get(GetScanLogs)
		})
	);

	api.use(
		'/v1/community-scanners',
		communityScannerRouter({
			registerCommunityScanner: kernel.container.get(RegisterCommunityScanner),
			sendScannerHeartbeat: kernel.container.get(SendScannerHeartbeat),
			getScannerMetrics: kernel.container.get(GetScannerMetrics)
		})
	);

	api.use(
		'/v1/history-scan',
		historyScanRouter({
			getLatestScan: kernel.container.get(GetLatestScan),
			getScanLogs: kernel.container.get(GetScanLogs),
			registerScan: kernel.container.get(RegisterScan),
			userName: config.historyScanAPIUsername,
			password: config.historyScanAPIPassword,
			frontendBaseUrl: config.frontendBaseUrl,
			frontendRevalidateToken: config.frontendRevalidateToken,
			getScanJob: kernel.container.get(GetScanJob),
			touchScanJob: kernel.container.get(TouchScanJob)
		})
	);

	api.use(function (req, res, next) {
		if (req.url.match(/^\/$/) || req.url.match('/v2/all')) {
			res.redirect(301, '/v1');
		}
		next();
	});

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
			getMeasurementAggregations: kernel.container.get(
				GetMeasurementAggregations
			),
			getMeasurementsFactory: kernel.container.get(GetMeasurementsFactory),
			getLatestNodeSnapshots: kernel.container.get(GetLatestNodeSnapshots),
			getLatestOrganizationSnapshots: kernel.container.get(
				GetLatestOrganizationSnapshots
			),
			getScpStatements: kernel.container.get(GetScpStatements),
			horizonUrl: config.horizonUrl.value,
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

	process.on('SIGTERM', async () => {
		console.log('SIGTERM signal received: closing HTTP server');
		await stop(kernel.container.get(DataSource));
	});

	process.on('SIGINT', async () => {
		console.log('SIGTERM signal received: closing HTTP server');
		await stop(kernel.container.get(DataSource));
	});
};

listen();

async function stop(dataSource: DataSource) {
	server.close(async () => {
		console.log('HTTP server closed');
		await dataSource.destroy();
		console.log('connection to db closed');
	});
}
