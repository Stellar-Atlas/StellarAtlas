import * as express from 'express';
import { Router } from 'express';
import { GetKnownNode } from '@network-scan/use-cases/get-known-node/GetKnownNode.js';
import { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';

export interface KnownNetworkRouterConfig {
	getKnownNode: GetKnownNode;
	getKnownNodes: GetKnownNodes;
	getKnownOrganization: GetKnownOrganization;
	getKnownOrganizations: GetKnownOrganizations;
}

const knownNetworkRouterWrapper = (
	config: KnownNetworkRouterConfig
): Router => {
	const knownNetworkRouter = express.Router();
	const cacheMaxAgeSeconds = 30;

	knownNetworkRouter.get(
		['/nodes/:publicKey'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + cacheMaxAgeSeconds);
			res.setHeader('Content-Type', 'application/json');

			const nodeOrError = await config.getKnownNode.execute(
				req.params.publicKey
			);
			if (nodeOrError.isErr())
				return res.status(500).json({ error: 'Internal Server Error' });
			if (nodeOrError.value === null)
				return res.status(404).json({ error: 'Known node not found' });

			return res.status(200).send(nodeOrError.value);
		}
	);

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
		['/organizations/:organizationId'],
		async (req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=' + cacheMaxAgeSeconds);
			res.setHeader('Content-Type', 'application/json');

			const organizationOrError = await config.getKnownOrganization.execute(
				req.params.organizationId
			);
			if (organizationOrError.isErr())
				return res.status(500).json({ error: 'Internal Server Error' });
			if (organizationOrError.value === null) {
				return res.status(404).json({ error: 'Known organization not found' });
			}

			return res.status(200).send(organizationOrError.value);
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
