import * as express from 'express';
import { Router } from 'express';
import { isDateString } from '../../../core/utilities/isDateString.js';
import { getDateFromParam } from '../../../core/utilities/getDateFromParam.js';
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

export interface NetworkRouterConfig {
	getNetwork: GetNetwork;
	getMeasurementsFactory: GetMeasurementsFactory;
	getMeasurementAggregations: GetMeasurementAggregations;
	getLatestNodeSnapshots: GetLatestNodeSnapshots;
	getLatestOrganizationSnapshots: GetLatestOrganizationSnapshots;
	getScpStatements: GetScpStatements;
}

const networkRouterWrapper = (config: NetworkRouterConfig): Router => {
	const networkRouter = express.Router();
	const liveNetworkIntervalMs = 5_000;

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

	const writeNetworkEvent = async (
		res: express.Response
	): Promise<void> => {
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

		res.write(`event: network\ndata: ${JSON.stringify(networkOrError.value)}\n\n`);
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
			res.setHeader('Cache-Control', 'public, max-age=' + 60); // cache for 60 seconds
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
