import * as express from 'express';
import { param, validationResult } from 'express-validator';
import type { GetHistoryArchiveEvidence } from '../../use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import { ArchiveEvidenceReadModelUnavailableError } from '../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import { InvalidUrlError } from '../../use-cases/get-latest-scan/InvalidUrlError.js';
import {
	archiveEvidencePageValidators,
	isArchiveEvidenceClientError,
	parseArchiveEvidencePageOptions
} from './ArchiveEvidencePageRequest.js';
import {
	PublicArchiveEvidenceAdmission,
	publicArchiveEvidenceAdmission,
	sendArchiveEvidenceError,
	setArchiveEvidenceCacheHeaders
} from './PublicArchiveEvidenceRequest.js';

export interface ArchiveEvidenceRouterConfig {
	readonly admission?: PublicArchiveEvidenceAdmission;
	readonly getHistoryArchiveEvidence: GetHistoryArchiveEvidence;
}

export function archiveEvidenceRouter(
	config: ArchiveEvidenceRouterConfig
): express.Router {
	const router = express.Router();
	const admission = config.admission ?? publicArchiveEvidenceAdmission;
	router.get(
		'/:encodedUrl/object-evidence',
		admission.middleware(),
		[param('encodedUrl').isURL(), ...archiveEvidencePageValidators()],
		async (req: express.Request, res: express.Response) => {
			setArchiveEvidenceCacheHeaders(res);
			if (!validationResult(req).isEmpty()) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}

			const result = await config.getHistoryArchiveEvidence.execute(
				req.params.encodedUrl,
				parseArchiveEvidencePageOptions(req)
			);
			if (
				result.isErr() &&
				(result.error instanceof InvalidUrlError ||
					isArchiveEvidenceClientError(result.error))
			) {
				return sendArchiveEvidenceError(
					res,
					400,
					'invalid_request',
					'Invalid archive evidence query'
				);
			}
			if (result.isErr()) {
				if (result.error instanceof ArchiveEvidenceReadModelUnavailableError) {
					res.setHeader('Retry-After', '5');
					return sendArchiveEvidenceError(
						res,
						503,
						'temporarily_unavailable',
						'Archive evidence is still being prepared'
					);
				}
				return sendArchiveEvidenceError(
					res,
					500,
					'internal_error',
					'Archive evidence is unavailable'
				);
			}
			return res.status(200).json(result.value);
		}
	);
	return router;
}
