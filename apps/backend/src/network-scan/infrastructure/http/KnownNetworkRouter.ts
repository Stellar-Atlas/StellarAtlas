import * as express from 'express';
import { Router } from 'express';
import { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';

export interface KnownNetworkRouterConfig {
	getKnownNodes: GetKnownNodes;
	getKnownOrganizations: GetKnownOrganizations;
}

const knownNetworkRouterWrapper = (
	config: KnownNetworkRouterConfig
): Router => {
	const knownNetworkRouter = express.Router();
	const cacheMaxAgeSeconds = 30;

	knownNetworkRouter.get(
		['/nodes'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + cacheMaxAgeSeconds);
			res.setHeader('Content-Type', 'application/json');

			const nodesOrError = await config.getKnownNodes.execute();
			if (nodesOrError.isErr())
				return res.status(500).json({ error: 'Internal Server Error' });

			return res.status(200).send(nodesOrError.value);
		}
	);

	knownNetworkRouter.get(
		['/organizations'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + cacheMaxAgeSeconds);
			res.setHeader('Content-Type', 'application/json');

			const organizationsOrError = await config.getKnownOrganizations.execute();
			if (organizationsOrError.isErr())
				return res.status(500).json({ error: 'Internal Server Error' });

			return res.status(200).send(organizationsOrError.value);
		}
	);

	return knownNetworkRouter;
};

export { knownNetworkRouterWrapper as knownNetworkRouter };
