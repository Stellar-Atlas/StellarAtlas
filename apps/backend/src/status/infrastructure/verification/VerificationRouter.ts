import express, { type Request, type RequestHandler } from 'express';
import {
	parseDecision,
	parseSubmission,
	record,
	target,
	VerificationError,
	type ControlEvidence,
	type Submission
} from './VerificationApplication.js';
import { VerificationWorkflow, type Reviewer } from './VerificationWorkflow.js';

/** No header, cookie or request-body field is implicitly trusted by this feature.
 * An app authentication adapter must supply these grants, verify CSRF/origin for
 * cookie sessions, apply shared admission limits and prove current account authority.
 * The legacy service-to-service mail/scanner passwords are NOT reviewer grants.
 */
export interface VerificationBoundary {
	applicant(request: Request): Promise<{ subjectId: string } | null>;
	reviewer(request: Request): Promise<Reviewer | null>;
	control(
		request: Request,
		input: Pick<Submission, 'network' | 'address'> & {
			readonly control?: ControlEvidence;
		},
		subjectId: string
	): Promise<ControlEvidence | null>;
}
export function verificationRouter(input: {
	enabled: boolean;
	workflow: VerificationWorkflow;
	boundary?: VerificationBoundary;
}): express.Router {
	if (input.enabled && !input.boundary)
		throw new Error(
			'Atlas verification requires trusted applicant, account-authority and reviewer adapters'
		);
	const router = express.Router();
	router.use((_req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		next();
	});
	router.get('/capabilities', (_req, res) =>
		res.json({
			available: input.enabled,
			accountControlRequired: true,
			identityReviewRequired: true
		})
	);
	router.use((_req, res, next) =>
		input.enabled
			? next()
			: res.status(503).json({
					error: 'Atlas verification is not accepting applications yet'
				})
	);
	const boundary = input.boundary;
	const applicant = async (request: Request) => {
		const grant = await boundary?.applicant(request);
		if (!grant)
			throw new VerificationError(401, 'Sign in to your Atlas account');
		return grant;
	};
	const reviewer = async (request: Request) => {
		const grant = await boundary?.reviewer(request);
		if (grant?.role !== 'identity-reviewer')
			throw new VerificationError(403, 'Identity reviewer permission required');
		return grant;
	};
	const route =
		(
			handler: (req: Request) => Promise<{ status?: number; body: unknown }>
		): RequestHandler =>
		(req, res) => {
			void handler(req)
				.then((result) => res.status(result.status ?? 200).json(result.body))
				.catch((error) => {
					const known = error instanceof VerificationError;
					if (known && error.status === 429) res.set('Retry-After', '60');
					res.status(known ? error.status : 503).json({
						error: known
							? error.message
							: 'Verification is temporarily unavailable'
					});
				});
		};
	const body = (request: Request) => {
		if (
			!request.is('application/json') ||
			Buffer.byteLength(JSON.stringify(request.body) ?? '') > 16 * 1024
		)
			throw new VerificationError(400, 'Supply a JSON request under 16 KiB');
		return record(request.body);
	};
	router.post(
		'/applications',
		route(async (req) => {
			const grant = await applicant(req);
			const submission = parseSubmission(body(req));
			const control = await boundary!.control(req, submission, grant.subjectId);
			return {
				status: 201,
				body: await input.workflow.submit(grant.subjectId, submission, control)
			};
		})
	);
	router.get(
		'/applications/:id',
		route(async (req) => {
			// Reviewers and owners have independent authentication paths.
			const reviewGrant = await boundary!.reviewer(req);
			const owner =
				reviewGrant?.role === 'identity-reviewer'
					? reviewGrant
					: await applicant(req);
			return {
				body: await input.workflow.read(
					req.params.id,
					owner.subjectId,
					reviewGrant
				)
			};
		})
	);
	router.post(
		'/applications/:id/resubmit',
		route(async (req) => {
			const grant = await applicant(req);
			const raw = body(req);
			const revision = raw.revision;
			if (!Number.isSafeInteger(revision) || Number(revision) < 1)
				throw new VerificationError(400, 'Supply the current revision');
			const { revision: _revision, ...fields } = raw;
			const submission = parseSubmission(fields);
			const control = await boundary!.control(req, submission, grant.subjectId);
			return {
				body: await input.workflow.resubmit(
					req.params.id,
					grant.subjectId,
					Number(revision),
					submission,
					control
				)
			};
		})
	);
	router.get(
		'/review',
		route(async (req) => {
			const grant = await reviewer(req);
			const after = req.query.after ?? '';
			if (typeof after !== 'string' || (after && !uuid(after)))
				throw new VerificationError(400, 'Invalid queue cursor');
			const items = await input.workflow.queue(grant, after);
			return {
				body: { items, nextCursor: items.length === 20 ? items[19]!.id : null }
			};
		})
	);
	router.post(
		'/applications/:id/decisions',
		route(async (req) => {
			const grant = await reviewer(req);
			const decision = parseDecision(body(req));
			const application = await input.workflow.read(
				req.params.id,
				grant.subjectId,
				grant
			);
			const control =
				decision.state === 'approved'
					? await boundary!.control(req, application, application.applicantId)
					: null;
			return {
				body: await input.workflow.review(
					application.id,
					grant,
					decision,
					control
				)
			};
		})
	);
	router.get(
		'/:network/:address',
		route(async (req) => {
			const account = target(req.params.network, req.params.address);
			return {
				body: {
					verification: await input.workflow.public(
						account.network,
						account.address
					)
				}
			};
		})
	);
	return router;
}
function uuid(value: string): boolean {
	return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}
