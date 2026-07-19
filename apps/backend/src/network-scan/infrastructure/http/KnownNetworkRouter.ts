import * as express from 'express';
import { Router } from 'express';
import { GetKnownNode } from '@network-scan/use-cases/get-known-node/GetKnownNode.js';
import { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';
import { validationResult } from 'express-validator';
import { GetKnownNodeArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-node-archive-evidence/GetKnownNodeArchiveEvidence.js';
import { GetKnownOrganizationArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-organization-archive-evidence/GetKnownOrganizationArchiveEvidence.js';
import {
	archiveEvidencePageValidators,
	isArchiveEvidenceClientError,
	parseArchiveEvidencePageOptions
} from '@history-scan-coordinator/infrastructure/http/ArchiveEvidencePageRequest.js';
import {
	publicArchiveEvidenceAdmission,
	sendArchiveEvidenceError,
	setArchiveEvidenceCacheHeaders
} from '@history-scan-coordinator/infrastructure/http/PublicArchiveEvidenceRequest.js';
import { ArchiveEvidenceReadModelUnavailableError } from '@history-scan-coordinator/domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import {
	parseKnownNodesPageRequest,
	parseKnownOrganizationsPageRequest
} from './KnownNetworkPageRequest.js';

export interface KnownNetworkRouterConfig {
	getKnownNode: GetKnownNode;
	getKnownNodeArchiveEvidence: GetKnownNodeArchiveEvidence;
	getKnownNodes: GetKnownNodes;
	getKnownOrganization: GetKnownOrganization;
	getKnownOrganizationArchiveEvidence: GetKnownOrganizationArchiveEvidence;
	getKnownOrganizations: GetKnownOrganizations;
}

const knownNetworkRouterWrapper = (
	config: KnownNetworkRouterConfig
): Router => {
	const knownNetworkRouter = express.Router();
	const cacheMaxAgeSeconds = 30;

	knownNetworkRouter.get(
		'/nodes/:publicKey/archive-evidence',
		publicArchiveEvidenceAdmission.middleware(),
		archiveEvidencePageValidators(),
		async (req: express.Request, res: express.Response) => {
			setArchiveEvidenceCacheHeaders(res);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}

			const result = await config.getKnownNodeArchiveEvidence.execute(
				req.params.publicKey,
				parseArchiveEvidencePageOptions(req)
			);
			if (result.isErr() && isArchiveEvidenceClientError(result.error)) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}
			if (result.isErr()) {
				if (result.error instanceof ArchiveEvidenceReadModelUnavailableError) {
					return sendUnavailableArchiveEvidence(res);
				}
				return sendArchiveEvidenceError(
					res,
					500,
					'internal_error',
					'Archive evidence is unavailable'
				);
			}
			if (result.value === null) {
				return sendArchiveEvidenceError(
					res,
					404,
					'not_found',
					'Known node not found'
				);
			}

			return res.status(200).json(result.value);
		}
	);

	knownNetworkRouter.get(
		'/organizations/:organizationId/archive-evidence',
		publicArchiveEvidenceAdmission.middleware(),
		archiveEvidencePageValidators(),
		async (req: express.Request, res: express.Response) => {
			setArchiveEvidenceCacheHeaders(res);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}

			const result = await config.getKnownOrganizationArchiveEvidence.execute(
				req.params.organizationId,
				parseArchiveEvidencePageOptions(req)
			);
			if (result.isErr() && isArchiveEvidenceClientError(result.error)) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}
			if (result.isErr()) {
				if (result.error instanceof ArchiveEvidenceReadModelUnavailableError) {
					return sendUnavailableArchiveEvidence(res);
				}
				return sendArchiveEvidenceError(
					res,
					500,
					'internal_error',
					'Archive evidence is unavailable'
				);
			}
			if (result.value === null) {
				return sendArchiveEvidenceError(
					res,
					404,
					'not_found',
					'Known organization not found'
				);
			}

			return res.status(200).json(result.value);
		}
	);

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

			const pageRequest = parseKnownNodesPageRequest(req);
			if (pageRequest === null) {
				return res.status(400).json({ error: 'Invalid known-node query' });
			}

			const nodesOrError = await config.getKnownNodes.execute(pageRequest);
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

			const pageRequest = parseKnownOrganizationsPageRequest(req);
			if (pageRequest === null) {
				return res
					.status(400)
					.json({ error: 'Invalid known-organization query' });
			}

			const organizationsOrError =
				await config.getKnownOrganizations.execute(pageRequest);
			if (organizationsOrError.isErr())
				return res.status(500).json({ error: 'Internal Server Error' });

			return res.status(200).send(organizationsOrError.value);
		}
	);

	return knownNetworkRouter;
};

export { knownNetworkRouterWrapper as knownNetworkRouter };

function sendUnavailableArchiveEvidence(
	res: express.Response
): express.Response {
	res.setHeader('Retry-After', '5');
	return sendArchiveEvidenceError(
		res,
		503,
		'temporarily_unavailable',
		'Archive evidence is still being prepared'
	);
}
