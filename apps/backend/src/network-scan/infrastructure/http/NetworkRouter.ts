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
import {
	fetchLatestLedger,
	fetchLedgerTransactions
} from './HorizonLedgerClient.js';
import { NetworkSearchService } from '../search/NetworkSearchService.js';
import type {
	NetworkSearchArchiveStatus,
	NetworkSearchConfig,
	NetworkSearchEntityType
} from '../search/NetworkSearchTypes.js';

export interface NetworkRouterConfig {
	getNetwork: GetNetwork;
	getMeasurementsFactory: GetMeasurementsFactory;
	getMeasurementAggregations: GetMeasurementAggregations;
	getLatestNodeSnapshots: GetLatestNodeSnapshots;
	getLatestOrganizationSnapshots: GetLatestOrganizationSnapshots;
	getScpStatements: GetScpStatements;
	horizonUrl: string;
	searchConfig: NetworkSearchConfig;
}

const isLedgerSequence = (value: string): boolean => /^\d+$/.test(value);

const isSearchEntityType = (
	value: string | undefined
): value is NetworkSearchEntityType =>
	value === 'node' || value === 'organization';

const isSearchArchiveStatus = (
	value: string | undefined
): value is NetworkSearchArchiveStatus =>
	value === 'error' || value === 'ok' || value === 'unknown';

const networkRouterWrapper = (config: NetworkRouterConfig): Router => {
	const networkRouter = express.Router();
	const liveNetworkIntervalMs = 5_000;
	const liveScpStatementIntervalMs = 1_200;
	const currentNetworkCacheMaxAgeSeconds = 10;
	const networkSearch = new NetworkSearchService(config.searchConfig);

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

		const limit = getBoundedSearchLimit(req.query.limit);
		if (limit === null) {
			return res.status(400).json({ error: 'Invalid search limit' });
		}

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

		const networkOrError = await config.getNetwork.execute({});
		if (networkOrError.isErr())
			return res.status(500).send('Internal Server Error');
		if (networkOrError.value === null)
			return res.status(404).send('No network found');

		const payload = await networkSearch.search(networkOrError.value, {
			active,
			archiveStatus: archiveStatusFilter,
			countryCode: getSearchString(req, 'countryCode'),
			entityType: entityTypeOverride ?? entityType,
			fullValidator,
			limit,
			organizationId: getSearchString(req, 'organizationId'),
			query: searchQuery,
			topTier,
			validating,
			validator
		});

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

	const writeScpStatementEvent = async (
		res: express.Response
	): Promise<void> => {
		const statementsOrError = await config.getScpStatements.execute({
			limit: 160
		});
		if (res.writableEnded) return;

		if (statementsOrError.isErr()) {
			res.write(
				`event: error\ndata: ${JSON.stringify({
					message: 'SCP statements unavailable'
				})}\n\n`
			);
			return;
		}

		res.write(
			`event: scp\ndata: ${JSON.stringify(statementsOrError.value)}\n\n`
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
			res.setHeader('Cache-Control', 'public, max-age=' + 5);
			res.setHeader('Content-Type', 'application/json');

			const statementsOrError = await config.getScpStatements.execute({
				limit: getOptionalLimit(req.query.limit),
				nodeId: getOptionalString(req.query.nodeId),
				slotIndex: getOptionalString(req.query.slotIndex)
			});

			if (statementsOrError.isErr())
				return res.status(500).send('Internal Server Error');

			return res.status(200).send(statementsOrError.value);
		}
	);

	networkRouter.get(
		['/scp-statements/live'],
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
				void writeScpStatementEvent(res).finally(() => {
					isWriting = false;
				});
			};

			writeSnapshot();
			const interval = setInterval(writeSnapshot, liveScpStatementIntervalMs);

			req.on('close', () => {
				clearInterval(interval);
				if (!res.writableEnded) res.end();
			});
		}
	);

	networkRouter.get(
		['/ledger/latest'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + 2);
			res.setHeader('Content-Type', 'application/json');

			try {
				const payload = await fetchLatestLedger(config.horizonUrl);
				return res.status(200).send(payload);
			} catch (error) {
				return res.status(502).send('Latest ledger unavailable');
			}
		}
	);

	networkRouter.get(
		['/scp/slots/:slotIndex/transactions'],
		async (req: express.Request, res: express.Response) => {
			const slotIndex = req.params.slotIndex;
			if (!isLedgerSequence(slotIndex))
				return res.status(400).send('Invalid ledger slot');

			res.setHeader('Cache-Control', 'public, max-age=' + 30);
			res.setHeader('Content-Type', 'application/json');

			try {
				const payload = await fetchLedgerTransactions(
					config.horizonUrl,
					slotIndex
				);
				return res.status(200).send(payload);
			} catch (error) {
				return res.status(502).send('Ledger transactions unavailable');
			}
		}
	);

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

	return networkRouter;
};

export { networkRouterWrapper as networkRouter };
