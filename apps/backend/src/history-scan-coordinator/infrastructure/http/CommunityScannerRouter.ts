import express, { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import {
	DuplicateCommunityScannerError,
	RegisterCommunityScanner
} from '../../use-cases/RegisterCommunityScanner.js';
import {
	CommunityScannerBlacklistedError,
	CommunityScannerNotFoundError,
	InvalidCommunityScannerApiKeyError,
	SendScannerHeartbeat,
	type ScannerHeartbeatDTO
} from '../../use-cases/SendScannerHeartbeat.js';
import { GetScannerMetrics } from '../../use-cases/GetScannerMetrics.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';
import {
	CommunityScannerAttributionNotFoundError,
	RegisterScan,
	ScanJobNotActiveError,
	ScanJobNotFoundError,
	ScanJobOwnershipError
} from '../../use-cases/register-scan/RegisterScan.js';
import {
	parseValidatedScanDto,
	requireObjectBody,
	scanDtoValidators
} from './ScanRequestValidation.js';

export interface CommunityScannerRouterConfig {
	readonly registerCommunityScanner: RegisterCommunityScanner;
	readonly sendScannerHeartbeat: SendScannerHeartbeat;
	readonly getScannerMetrics: GetScannerMetrics;
	readonly getScanJob: GetScanJob;
	readonly touchScanJob: TouchScanJob;
	readonly registerScan: RegisterScan;
}

const communityScannerCacheMaxAgeSeconds = 10;

export const CommunityScannerRouterWrapper = (
	config: CommunityScannerRouterConfig
): Router => {
	const communityScannerRouter = express.Router();

	communityScannerRouter.post(
		'/register',
		requireObjectBody,
		[
			body('name')
				.isString()
				.trim()
				.isLength({ min: 1, max: 100 })
				.withMessage('name must be 1 to 100 characters'),
			body('description')
				.optional({ nullable: true })
				.isString()
				.trim()
				.isLength({ max: 500 })
				.withMessage('description must be 500 characters or less'),
			body('contactEmail')
				.isEmail()
				.normalizeEmail()
				.isLength({ max: 255 })
				.withMessage('contactEmail must be a valid email address')
		],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const registerResult = await config.registerCommunityScanner.execute({
				name: req.body.name,
				description: req.body.description,
				contactEmail: req.body.contactEmail
			});
			if (
				registerResult.isErr() &&
				registerResult.error instanceof DuplicateCommunityScannerError
			) {
				return res.status(409).json({ error: registerResult.error.message });
			}
			if (registerResult.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(201).json(registerResult.value);
		}
	);

	communityScannerRouter.get('/metrics', async function (_req, res) {
		res.setHeader(
			'Cache-Control',
			'public, max-age=' + communityScannerCacheMaxAgeSeconds
		);

		const metricsResult = await config.getScannerMetrics.execute();
		if (metricsResult.isErr()) {
			return res.status(500).json({ error: 'Internal server error' });
		}

		return res.status(200).json(metricsResult.value);
	});

	communityScannerRouter.post(
		'/:id/heartbeat',
		[param('id').isUUID().withMessage('Invalid scanner id')],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const apiKey = getBearerApiKey(req);
			if (apiKey === null) {
				return res.status(401).json({
					error: 'Invalid authorization format. Use: Bearer <api-key>'
				});
			}

			const heartbeatResult = await config.sendScannerHeartbeat.execute({
				scannerId: req.params.id,
				apiKey
			});
			if (
				heartbeatResult.isErr() &&
				heartbeatResult.error instanceof CommunityScannerNotFoundError
			) {
				return res.status(404).json({ error: heartbeatResult.error.message });
			}
			if (
				heartbeatResult.isErr() &&
				heartbeatResult.error instanceof InvalidCommunityScannerApiKeyError
			) {
				return res.status(401).json({ error: heartbeatResult.error.message });
			}
			if (
				heartbeatResult.isErr() &&
				heartbeatResult.error instanceof CommunityScannerBlacklistedError
			) {
				return res.status(403).json({ error: heartbeatResult.error.message });
			}
			if (heartbeatResult.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(heartbeatResult.value);
		}
	);

	communityScannerRouter.get(
		'/:id/job',
		[param('id').isUUID().withMessage('Invalid scanner id')],
		async function (req: express.Request, res: express.Response) {
			if (!isRequestValid(req, res)) return;

			const scannerId = await requireAuthenticatedScanner(req, res, config);
			if (scannerId === null) return;

			const scanJobResult = await config.getScanJob.execute({
				communityScannerId: scannerId
			});
			if (scanJobResult.isErr()) {
				return res.status(500).json({ error: scanJobResult.error.message });
			}
			if (scanJobResult.value === null) {
				return res.status(204).json({ message: 'No scan job available' });
			}

			return res.status(200).json(scanJobResult.value);
		}
	);

	communityScannerRouter.post(
		'/:id/job/:remoteId/heartbeat',
		[
			param('id').isUUID().withMessage('Invalid scanner id'),
			param('remoteId').isUUID().withMessage('Invalid scan job remoteId')
		],
		async function (req: express.Request, res: express.Response) {
			if (!isRequestValid(req, res)) return;

			const scannerId = await requireAuthenticatedScanner(req, res, config);
			if (scannerId === null) return;

			const result = await config.touchScanJob.execute(req.params.remoteId, {
				communityScannerId: scannerId
			});
			if (result.isErr()) {
				return res.status(500).json({ error: result.error.message });
			}
			if (!result.value) {
				return res.status(404).json({ error: 'Scan job not found' });
			}

			return res.status(204).send();
		}
	);

	communityScannerRouter.post(
		'/:id/scans',
		[
			param('id').isUUID().withMessage('Invalid scanner id'),
			...scanDtoValidators,
			body('scanJobRemoteId').isUUID().withMessage('Invalid scan job remoteId')
		],
		requireObjectBody,
		async function (req: express.Request, res: express.Response) {
			if (!isRequestValid(req, res)) return;

			const scannerId = await requireAuthenticatedScanner(req, res, config);
			if (scannerId === null) return;

			const dto = parseValidatedScanDto(req, res);
			if (dto === null) return;

			const result = await config.registerScan.execute(dto, {
				communityScannerId: scannerId
			});
			if (result.isErr()) {
				return mapRegisterScanError(result.error, res);
			}

			return res.status(201).json({ message: 'Scan created successfully' });
		}
	);

	return communityScannerRouter;
};

function getBearerApiKey(req: express.Request): string | null {
	const authorization = req.get('Authorization');
	if (!authorization) return null;

	const parts = authorization.trim().split(/\s+/);
	if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1].length === 0) {
		return null;
	}

	return parts[1];
}

function isRequestValid(req: express.Request, res: express.Response): boolean {
	const errors = validationResult(req);
	if (errors.isEmpty()) return true;

	res.status(400).json({ errors: errors.array() });
	return false;
}

async function requireAuthenticatedScanner(
	req: express.Request,
	res: express.Response,
	config: CommunityScannerRouterConfig
): Promise<string | null> {
	const heartbeat = await sendAuthenticatedScannerHeartbeat(req, res, config);
	return heartbeat === null ? null : heartbeat.id;
}

async function sendAuthenticatedScannerHeartbeat(
	req: express.Request,
	res: express.Response,
	config: CommunityScannerRouterConfig
): Promise<ScannerHeartbeatDTO | null> {
	const apiKey = getBearerApiKey(req);
	if (apiKey === null) {
		res.status(401).json({
			error: 'Invalid authorization format. Use: Bearer <api-key>'
		});
		return null;
	}

	const heartbeatResult = await config.sendScannerHeartbeat.execute({
		scannerId: req.params.id,
		apiKey
	});
	if (heartbeatResult.isErr()) {
		mapScannerAuthError(heartbeatResult.error, res);
		return null;
	}

	return heartbeatResult.value;
}

function mapScannerAuthError(
	error: Error,
	res: express.Response
): express.Response {
	if (error instanceof CommunityScannerNotFoundError) {
		return res.status(404).json({ error: error.message });
	}
	if (error instanceof InvalidCommunityScannerApiKeyError) {
		return res.status(401).json({ error: error.message });
	}
	if (error instanceof CommunityScannerBlacklistedError) {
		return res.status(403).json({ error: error.message });
	}

	return res.status(500).json({ error: 'Internal server error' });
}

function mapRegisterScanError(
	error: Error,
	res: express.Response
): express.Response {
	if (
		error instanceof ScanJobNotFoundError ||
		error instanceof CommunityScannerAttributionNotFoundError
	) {
		return res.status(404).json({ error: error.message });
	}
	if (error instanceof ScanJobOwnershipError) {
		return res.status(403).json({ error: error.message });
	}
	if (error instanceof ScanJobNotActiveError) {
		return res.status(409).json({ error: error.message });
	}

	return res.status(500).json({ error: 'Internal server error' });
}

export { CommunityScannerRouterWrapper as communityScannerRouter };
