import express, { type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ContractProvenanceService } from '../http/contract-provenance/ContractProvenanceService.js';
import {
	DeveloperSubmissionError,
	developerSubmissionIdPattern,
	developerSubmissionResult,
	developerSubmissionRetentionDays,
	parseDeveloperSubmission,
	type DeveloperSubmissionStore
} from './DeveloperSubmission.js';

const parseBody = express.json({ limit: '2kb', strict: true });

/** Mount before the general API parser so whitespace and compressed input are bounded too. */
export const developerSubmissionBodyParser: RequestHandler = (
	req,
	res,
	next
) => {
	parseBody(req, res, (error?: unknown) => {
		if (!error) {
			next();
			return;
		}
		const oversized =
			typeof error === 'object' &&
			error !== null &&
			'status' in error &&
			error.status === 413;
		res.set('Cache-Control', 'private, no-store');
		send(res, oversized ? 413 : 400, { code: 'invalid_submission' });
	});
};

export function developerSubmissionRouter(input: {
	readonly origin: string;
	readonly networkPassphrase: string;
	readonly applicant: (
		request: Request
	) => Promise<{ readonly subjectId: string } | null>;
	readonly store: DeveloperSubmissionStore;
	readonly verifier: Pick<ContractProvenanceService, 'get'>;
}): express.Router {
	const router = express.Router();
	let active = 0;
	router.use((_req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		res.set('Referrer-Policy', 'no-referrer');
		next();
	});
	router.get('/submissions/capabilities', (_req, res) => {
		send(res, 200, {
			available: true,
			verification: 'published_build_attestation',
			retentionDays: developerSubmissionRetentionDays
		});
	});
	router.use(
		'/submissions',
		rateLimit({
			windowMs: 60_000,
			limit: 120,
			keyGenerator: () => 'developer-submissions',
			legacyHeaders: false,
			handler: (_req, res) => {
				res.set('Retry-After', '60');
				send(res, 429, { code: 'submission_busy' });
			}
		})
	);
	const applicant = async (req: Request) => {
		const grant = await input.applicant(req);
		if (!grant) throw new DeveloperSubmissionError(401, 'sign_in_required');
		return grant;
	};
	const failure = (res: express.Response, error: unknown) => {
		const known = error instanceof DeveloperSubmissionError;
		if (known && error.status === 429) res.set('Retry-After', '60');
		send(res, known ? error.status : 503, {
			code: known ? error.code : 'submission_unavailable'
		});
	};
	router.post('/submissions', async (req, res) => {
		if (req.get('Origin') !== input.origin) {
			send(res, 403, { code: 'origin_mismatch' });
			return;
		}
		let admitted = false;
		try {
			const grant = await applicant(req);
			if (active >= 2)
				throw new DeveloperSubmissionError(429, 'submission_busy');
			active++;
			admitted = true;
			if (Buffer.byteLength(JSON.stringify(req.body) ?? '') > 2048)
				throw new DeveloperSubmissionError(413, 'invalid_submission');
			if (!req.is('application/json'))
				throw new DeveloperSubmissionError(400, 'invalid_submission');
			const key = req.get('Idempotency-Key') ?? '';
			if (!developerSubmissionIdPattern.test(key))
				throw new DeveloperSubmissionError(400, 'invalid_idempotency_key');
			const request = parseDeveloperSubmission(req.body);
			const saved = await input.store.create(
				grant.subjectId,
				key,
				request,
				input.networkPassphrase
			);
			if (!saved.created) {
				send(res, 200, saved.submission);
				return;
			}
			let result;
			try {
				const evidence = await input.verifier.get(request.contractId);
				result = developerSubmissionResult(
					request,
					input.networkPassphrase,
					evidence
				);
			} catch {
				result = { status: 'unavailable' as const, evidence: null };
			}
			send(
				res,
				201,
				await input.store.finish(grant.subjectId, saved.submission.id, result)
			);
		} catch (error) {
			failure(res, error);
		} finally {
			if (admitted) active--;
		}
	});
	router.get('/submissions/:id', async (req, res) => {
		try {
			const grant = await applicant(req);
			const id = req.params.id ?? '';
			const saved = developerSubmissionIdPattern.test(id)
				? await input.store.read(grant.subjectId, id)
				: null;
			if (!saved)
				throw new DeveloperSubmissionError(404, 'submission_not_found');
			send(res, 200, saved);
		} catch (error) {
			failure(res, error);
		}
	});
	return router;
}

function send(response: express.Response, status: number, body: object): void {
	const json = JSON.stringify(body).replace(
		/[<>&]/g,
		(character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')
	);
	response.removeHeader('ETag');
	response.status(status).type('application/json').end(json);
}
