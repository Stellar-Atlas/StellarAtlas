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
	SendScannerHeartbeat
} from '../../use-cases/SendScannerHeartbeat.js';
import { GetScannerMetrics } from '../../use-cases/GetScannerMetrics.js';

export interface CommunityScannerRouterConfig {
	readonly registerCommunityScanner: RegisterCommunityScanner;
	readonly sendScannerHeartbeat: SendScannerHeartbeat;
	readonly getScannerMetrics: GetScannerMetrics;
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

	return communityScannerRouter;
};

function requireObjectBody(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
): express.Response | void {
	if (
		typeof req.body !== 'object' ||
		req.body === null ||
		Array.isArray(req.body)
	) {
		return res.status(400).json({ error: 'Request body must be an object' });
	}

	next();
}

function getBearerApiKey(req: express.Request): string | null {
	const authorization = req.get('Authorization');
	if (!authorization) return null;

	const parts = authorization.trim().split(/\s+/);
	if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1].length === 0) {
		return null;
	}

	return parts[1];
}

export { CommunityScannerRouterWrapper as communityScannerRouter };
