import express from 'express';
import { record, VerificationError } from './VerificationApplication.js';
import { VerificationStellarAuth } from './VerificationStellarAuth.js';

export function verificationAuthRouter(
	auth: VerificationStellarAuth
): express.Router {
	const router = express.Router();
	router.use((_req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		next();
	});
	const route =
		(
			handler: (req: express.Request) => Promise<unknown>
		): express.RequestHandler =>
		(req, res) => {
			void Promise.resolve()
				.then(() => {
					auth.checkOrigin(req);
					return handler(req);
				})
				.then((body) => res.json(body))
				.catch((error) => {
					const known = error instanceof VerificationError;
					if (known && error.status === 429) res.set('Retry-After', '60');
					res
						.status(known ? error.status : 503)
						.json({
							error: known
								? error.message
								: 'Authentication is temporarily unavailable'
						});
				});
		};
	const body = (req: express.Request, fields: string[]) => {
		if (
			!req.is('application/json') ||
			Buffer.byteLength(JSON.stringify(req.body) ?? '') > 18 * 1024
		)
			throw new VerificationError(
				400,
				'Supply a bounded JSON authentication request'
			);
		const input = record(req.body);
		if (Object.keys(input).some((key) => !fields.includes(key)))
			throw new VerificationError(400, 'Unsupported authentication field');
		return input;
	};
	router.post(
		'/challenge',
		route(async (req) => {
			const input = body(req, ['network', 'address']);
			return auth.challenge(input.network, input.address);
		})
	);
	router.post(
		'/session',
		route(async (req) => {
			const input = body(req, ['network', 'transaction']);
			return auth.exchange(input.network, input.transaction);
		})
	);
	router.delete(
		'/session',
		route(async (req) => {
			await auth.logout(req);
			return { signedOut: true };
		})
	);
	return router;
}
