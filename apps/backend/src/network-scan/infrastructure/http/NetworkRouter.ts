import * as express from 'express';
import { Router } from 'express';
import { isDateString } from '@core/utilities/isDateString.js';
import { getDateFromParam } from '@core/utilities/getDateFromParam.js';
import { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import { GetLatestNodeSnapshots } from '../../use-cases/get-latest-node-snapshots/GetLatestNodeSnapshots.js';
import { GetLatestOrganizationSnapshots } from '../../use-cases/get-latest-organization-snapshots/GetLatestOrganizationSnapshots.js';
import { GetMeasurementsFactory } from '../../use-cases/get-measurements/GetMeasurementsFactory.js';
import NetworkMeasurement from '../../domain/network/NetworkMeasurement.js';
import { GetMeasurementAggregations } from '../../use-cases/get-measurement-aggregations/GetMeasurementAggregations.js';
import { AggregationTarget } from '../../use-cases/get-measurement-aggregations/GetMeasurementAggregationsDTO.js';
import { query } from 'express-validator';
import { handleMeasurementsAggregationRequest } from './handleMeasurementsAggregationRequest.js';
import { GetScpStatements } from '../../use-cases/get-scp-statements/GetScpStatements.js';
import { handleScpStatementsRequest } from './handleScpStatementsRequest.js';
import { NetworkSearchService } from '../search/NetworkSearchService.js';
import { NetworkSearchInventoryLoader } from '../search/NetworkSearchInventoryLoader.js';
import { NetworkSearchProjectionRefresher } from '../search/NetworkSearchProjectionRefresher.js';
import { networkSearchMaxOffset } from '../search/NetworkSearchQuery.js';
import { getSharedScpStatementLiveHub } from './ScpStatementLiveHub.js';
import { createScpStatementSseSubscriber } from './ScpStatementSseSubscriber.js';
import type {
	NetworkSearchArchiveStatus,
	NetworkSearchConfig,
	NetworkSearchEntityType
} from '../search/NetworkSearchTypes.js';
import type { Logger } from '@core/services/Logger.js';
import { GetKnownNodes } from '../../use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganizations } from '../../use-cases/get-known-organizations/GetKnownOrganizations.js';
import type { KnownNodeScope } from '../../use-cases/known-network-scope/KnownNetworkScope.js';
import type { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { GetScpEvidence } from '../../use-cases/get-scp-evidence/GetScpEvidence.js';
import { scpEvidenceRouter } from './ScpEvidenceRouter.js';
import type { NetworkScanRepository } from '../../domain/network/scan/NetworkScanRepository.js';

export interface NetworkRouterConfig {
	getNetwork: GetNetwork;
	getMeasurementsFactory: GetMeasurementsFactory;
	getMeasurementAggregations: GetMeasurementAggregations;
	getLatestNodeSnapshots: GetLatestNodeSnapshots;
	getLatestOrganizationSnapshots: GetLatestOrganizationSnapshots;
	getKnownNodes: GetKnownNodes;
	getKnownOrganizations: GetKnownOrganizations;
	getKnownArchiveEvidence: GetKnownArchiveEvidence;
	getScpStatements: GetScpStatements;
	logger?: Logger;
	networkScanRepository: NetworkScanRepository;
	searchConfig: NetworkSearchConfig;
}

export interface NetworkRouter extends Router {
	stopNetworkSearchProjection(): void;
}

const isSearchEntityType = (
	value: string | undefined
): value is NetworkSearchEntityType =>
	value === 'archive-root' || value === 'node' || value === 'organization';

const isSearchArchiveStatus = (
	value: string | undefined
): value is NetworkSearchArchiveStatus =>
	value === 'error' || value === 'ok' || value === 'unknown';

const isSearchScope = (value: string | undefined): value is KnownNodeScope =>
	value === 'current-validator' ||
	value === 'listener' ||
	value === 'public-key-only' ||
	value === 'archived' ||
	value === 'all-known';

const networkRouterWrapper = (config: NetworkRouterConfig): NetworkRouter => {
	const networkRouter = express.Router();
	const liveNetworkIntervalMs = 5_000;
	const currentNetworkCacheMaxAgeSeconds = 10;
	const networkSearch = new NetworkSearchService(
		config.searchConfig,
		config.logger
	);
	const networkSearchInventory = new NetworkSearchInventoryLoader({
		getKnownArchiveEvidence: config.getKnownArchiveEvidence,
		getKnownNodes: config.getKnownNodes,
		getKnownOrganizations: config.getKnownOrganizations,
		getNetwork: config.getNetwork
	});
	const networkSearchProjection = new NetworkSearchProjectionRefresher(
		networkSearchInventory,
		networkSearch,
		config.logger,
		{
			enabled:
				config.searchConfig.writable !== false &&
				(config.searchConfig.host?.length ?? 0) > 0
		}
	);
	networkSearchProjection.start();
	const scpStatementLiveHub = getSharedScpStatementLiveHub(
		config.getScpStatements,
		config.logger
	);
	const scpEvidence = new GetScpEvidence(
		config.getScpStatements,
		config.getKnownNodes
	);

	const getTime = (at?: unknown): Date => {
		return at && isDateString(at) ? getDateFromParam(at) : new Date();
	};

	const getOptionalString = (
		value: express.Request['query'][string]
	): string | undefined => (typeof value === 'string' ? value : undefined);

	const getOptionalLimit = (
		value: express.Request['query'][string]
	): number | undefined => {
		if (typeof value !== 'string') return undefined;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	};

	const getSearchString = (
		req: express.Request,
		name: string
	): string | undefined => getOptionalString(req.query[name]);

	const getBoundedSearchLimit = (
		value: express.Request['query'][string]
	): number | null => {
		if (value === undefined) return 8;
		const parsed = getOptionalLimit(value);
		if (parsed === undefined || !Number.isInteger(parsed)) return null;
		return parsed >= 1 && parsed <= 25 ? parsed : null;
	};

	const getBoundedSearchOffset = (
		value: express.Request['query'][string]
	): number | null => {
		if (value === undefined) return 0;
		const parsed = getOptionalLimit(value);
		if (parsed === undefined || !Number.isInteger(parsed)) return null;
		return parsed >= 0 && parsed <= networkSearchMaxOffset ? parsed : null;
	};

	const getSearchBoolean = (
		value: express.Request['query'][string]
	): boolean | null | undefined => {
		if (value === undefined) return undefined;
		const textValue = getOptionalString(value);
		if (textValue === 'true') return true;
		if (textValue === 'false') return false;
		return null;
	};

	const handleSearchRequest = async (
		req: express.Request,
		res: express.Response,
		entityTypeOverride?: NetworkSearchEntityType
	): Promise<express.Response> => {
		res.setHeader('Cache-Control', 'public, max-age=' + 5);
		res.setHeader('Content-Type', 'application/json');
		const singleValueParams = [
			'archiveStatus',
			'countryCode',
			'organizationId',
			'q',
			'scope',
			'type'
		] as const;
		if (
			singleValueParams.some(
				(name) =>
					req.query[name] !== undefined && typeof req.query[name] !== 'string'
			)
		) {
			return res
				.status(400)
				.json({ error: 'Invalid repeated search parameter' });
		}

		const limit = getBoundedSearchLimit(req.query.limit);
		const offset = getBoundedSearchOffset(req.query.offset);
		if (limit === null || offset === null) {
			return res.status(400).json({ error: 'Invalid search pagination' });
		}
		const requestedScope = getSearchString(req, 'scope');
		if (requestedScope && !isSearchScope(requestedScope)) {
			return res.status(400).json({ error: 'Invalid search scope' });
		}
		const scope = isSearchScope(requestedScope) ? requestedScope : 'all-known';

		const requestedType = getSearchString(req, 'type');
		if (requestedType && !isSearchEntityType(requestedType)) {
			return res.status(400).json({ error: 'Invalid search entity type' });
		}
		const entityType = isSearchEntityType(requestedType)
			? requestedType
			: undefined;

		const archiveStatus = getSearchString(req, 'archiveStatus');
		if (archiveStatus && !isSearchArchiveStatus(archiveStatus)) {
			return res.status(400).json({ error: 'Invalid archive status' });
		}
		const archiveStatusFilter = isSearchArchiveStatus(archiveStatus)
			? archiveStatus
			: undefined;

		const validator = getSearchBoolean(req.query.validator);
		const validating = getSearchBoolean(req.query.validating);
		const fullValidator = getSearchBoolean(req.query.fullValidator);
		const active = getSearchBoolean(req.query.active);
		const topTier = getSearchBoolean(req.query.topTier);
		if (
			validator === null ||
			validating === null ||
			fullValidator === null ||
			active === null ||
			topTier === null
		) {
			return res.status(400).json({ error: 'Invalid boolean filter' });
		}

		const searchQuery = getSearchString(req, 'q')?.trim() ?? '';
		if (searchQuery.length > 128) {
			return res.status(400).json({ error: 'Search query is too long' });
		}
		const searchRequest = {
			active,
			archiveStatus: archiveStatusFilter,
			countryCode: getSearchString(req, 'countryCode'),
			entityType: entityTypeOverride ?? entityType,
			fullValidator,
			limit,
			offset,
			organizationId: getSearchString(req, 'organizationId'),
			query: searchQuery,
			scope,
			topTier,
			validating,
			validator
		};
		let canonicalNetworkTime: Date | undefined;
		try {
			canonicalNetworkTime =
				await config.networkScanRepository.findLatestSuccessfulScanTime();
		} catch (error: unknown) {
			config.logger?.warn('Canonical network time read failed', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
		const indexedPayload = await networkSearch.searchIndexed(
			searchRequest,
			canonicalNetworkTime
		);
		if (indexedPayload !== null) {
			return res.status(200).send(indexedPayload);
		}

		const inventoryOrError = await networkSearchInventory.load();
		if (inventoryOrError.isErr())
			return res.status(500).send('Internal Server Error');
		if (inventoryOrError.value === null)
			return res.status(404).send('No network found');

		const payload = await networkSearch.search(
			inventoryOrError.value,
			searchRequest
		);

		return res.status(200).send(payload);
	};

	const writeNetworkEvent = async (res: express.Response): Promise<void> => {
		const networkOrError = await config.getNetwork.execute({});
		if (res.writableEnded) return;

		if (networkOrError.isErr()) {
			res.write(
				`event: error\ndata: ${JSON.stringify({
					message: 'Network snapshot unavailable'
				})}\n\n`
			);
			return;
		}

		if (networkOrError.value === null) {
			res.write(
				`event: error\ndata: ${JSON.stringify({
					message: 'No network found'
				})}\n\n`
			);
			return;
		}

		res.write(
			`event: network\ndata: ${JSON.stringify(networkOrError.value)}\n\n`
		);
	};

	networkRouter.get(
		['/live'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'no-cache, no-transform');
			res.setHeader('Connection', 'keep-alive');
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('X-Accel-Buffering', 'no');
			res.flushHeaders();
			res.write(': connected\n\n');

			let isWriting = false;
			const writeSnapshot = (): void => {
				if (isWriting || res.writableEnded) return;
				isWriting = true;
				void writeNetworkEvent(res).finally(() => {
					isWriting = false;
				});
			};

			writeSnapshot();
			const interval = setInterval(writeSnapshot, liveNetworkIntervalMs);

			req.on('close', () => {
				clearInterval(interval);
				if (!res.writableEnded) res.end();
			});
		}
	);

	networkRouter.get(
		['/'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + currentNetworkCacheMaxAgeSeconds
			);
			res.setHeader('Content-Type', 'application/json');
			const networkOrError = await config.getNetwork.execute({
				at: req.query.at ? getTime(req.query.at) : undefined
			});
			if (networkOrError.isErr()) res.status(500).send('Internal Server Error');
			else if (networkOrError.value === null)
				res.status(404).send('No network found');
			else res.send(networkOrError.value);
		}
	);

	networkRouter.get(
		['/month-statistics'],
		[query('from').custom(isDateString), query('to').custom(isDateString)],
		async (req: express.Request, res: express.Response) => {
			return await handleMeasurementsAggregationRequest(
				'public',
				req,
				res,
				AggregationTarget.NetworkMonth,
				config.getMeasurementAggregations
			);
		}
	);

	networkRouter.get(
		['/day-statistics'],
		[query('from').custom(isDateString), query('to').custom(isDateString)],
		async (req: express.Request, res: express.Response) => {
			return await handleMeasurementsAggregationRequest(
				'public',
				req,
				res,
				AggregationTarget.NetworkDay,
				config.getMeasurementAggregations
			);
		}
	);

	networkRouter.get(
		['/statistics'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + 30); // cache header
			res.setHeader('Content-Type', 'application/json');

			const useCase =
				config.getMeasurementsFactory.createFor(NetworkMeasurement);
			const to = req.query.to;
			const from = req.query.from;

			if (!isDateString(to) || !isDateString(from)) {
				res.status(400);
				res.send('invalid or missing to or from parameters');
				return;
			}

			const statsOrError = await useCase.execute({
				from: getDateFromParam(req.query.from),
				to: getDateFromParam(req.query.to),
				id: 'network'
			});

			if (statsOrError.isErr()) {
				res.status(500).send('Internal Server Error');
			} else res.send(statsOrError.value);
		}
	);

	networkRouter.get(
		['/search'],
		async (req: express.Request, res: express.Response) => {
			return handleSearchRequest(req, res);
		}
	);

	networkRouter.get(
		['/search/nodes'],
		async (req: express.Request, res: express.Response) => {
			return handleSearchRequest(req, res, 'node');
		}
	);

	networkRouter.get(
		['/search/organizations'],
		async (req: express.Request, res: express.Response) => {
			return handleSearchRequest(req, res, 'organization');
		}
	);

	networkRouter.get(
		['/scp-statements'],
		async (req: express.Request, res: express.Response) => {
			return handleScpStatementsRequest(req, res, config.getScpStatements);
		}
	);

	networkRouter.get(
		['/scp-statements/live'],
		async (req: express.Request, res: express.Response) => {
			const unsubscribe = scpStatementLiveHub.subscribe(
				createScpStatementSseSubscriber(res, config.logger)
			);
			if (unsubscribe === null) {
				return res
					.status(503)
					.json({ error: 'SCP live stream is at capacity' });
			}
			res.setHeader('Cache-Control', 'no-cache, no-transform');
			res.setHeader('Connection', 'keep-alive');
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('X-Accel-Buffering', 'no');
			res.flushHeaders();
			const closeStream = (): void => {
				unsubscribe();
				if (!res.writableEnded) res.end();
			};
			req.once('close', closeStream);
			if (!res.write(': connected\n\n')) closeStream();
		}
	);

	networkRouter.use('/scp/evidence', scpEvidenceRouter(scpEvidence));

	networkRouter.get(
		['/node-snapshots'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + 30); // cache header
			res.setHeader('Content-Type', 'application/json');

			const snapshotsOrError = await config.getLatestNodeSnapshots.execute({
				at: getDateFromParam(req.query.at)
			});
			if (snapshotsOrError.isErr())
				return res.status(500).send('Internal Server Error');
			res.send(snapshotsOrError.value);
		}
	);

	networkRouter.get(
		['/organization-snapshots'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + 30); // cache header
			res.setHeader('Content-Type', 'application/json');
			const snapshotsOrError =
				await config.getLatestOrganizationSnapshots.execute({
					at: getDateFromParam(req.query.at)
				});
			if (snapshotsOrError.isErr())
				return res.status(500).send('Internal Server Error');
			res.send(snapshotsOrError.value);
		}
	);

	return Object.assign(networkRouter, {
		stopNetworkSearchProjection: (): void => networkSearchProjection.stop()
	});
};

export { networkRouterWrapper as networkRouter };
