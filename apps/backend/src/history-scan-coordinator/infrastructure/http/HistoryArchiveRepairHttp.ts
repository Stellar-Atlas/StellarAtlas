import type express from 'express';
import type { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
import { pipeline } from 'node:stream/promises';
import { GetHistoryArchiveRepairArtifact } from '../../use-cases/get-history-archive-repair-artifact/GetHistoryArchiveRepairArtifact.js';
import {
	GetHistoryArchiveRepairObjectArtifact,
	type GetHistoryArchiveRepairObjectArtifactResult
} from '../../use-cases/get-history-archive-repair-artifact/GetHistoryArchiveRepairObjectArtifact.js';
import {
	GetHistoryArchiveRepairPlan,
	maxRepairPlanLimit
} from '../../use-cases/get-history-archive-repair-plan/GetHistoryArchiveRepairPlan.js';
import { InvalidUrlError } from '../../use-cases/get-latest-scan/InvalidUrlError.js';
import type { HistoryArchiveRepairArtifactUnavailableV1 } from '../../use-cases/get-history-archive-repair-artifact/HistoryArchiveRepairArtifactContract.js';

const planCacheMaxAgeSeconds = 10;
const artifactCacheMaxAgeSeconds = 31_536_000;

export interface HistoryArchiveRepairHttpConfig {
	getHistoryArchiveRepairArtifact: GetHistoryArchiveRepairArtifact;
	getHistoryArchiveRepairObjectArtifact: GetHistoryArchiveRepairObjectArtifact;
	getHistoryArchiveRepairPlan: GetHistoryArchiveRepairPlan;
}

export function mountHistoryArchiveRepairRoutes(
	router: Router,
	config: HistoryArchiveRepairHttpConfig
): void {
	router.get(
		'/repair-artifacts/buckets/:bucketHash',
		[param('bucketHash').matches(/^[0-9a-f]{64}$/i)],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return respondUnavailable(res, {
					artifactType: 'bucket',
					contentHash: null,
					objectIdentity: null,
					reason: 'invalid-object-identity',
					retry: { afterSeconds: null, retryable: false },
					status: 'unavailable'
				});
			}

			const result = await config.getHistoryArchiveRepairArtifact.execute(
				req.params.bucketHash
			);
			if (result.status === 'unavailable') {
				return respondUnavailable(res, result);
			}

			res.status(200);
			res.setHeader('Content-Type', result.artifact.mediaType);
			res.setHeader('Content-Length', String(result.artifact.byteLength));
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${result.fileName}"`
			);
			res.setHeader(
				'Cache-Control',
				`public, max-age=${artifactCacheMaxAgeSeconds}, immutable`
			);
			res.setHeader(
				'X-Stellar-Bucket-Hash',
				result.artifact.contentHash.digest
			);

			try {
				await pipeline(result.stream, res);
			} catch {
				if (!res.headersSent) {
					return res.status(500).json({ error: 'Internal server error' });
				}
				res.destroy();
			} finally {
				await result.close();
			}
		}
	);

	router.get(
		'/repair-artifacts/objects/:targetRemoteId/:candidateRemoteId/:proofId/:proofVersion/:proofEvaluatedAtMs/:contentDigest',
		[
			param('targetRemoteId').isUUID(),
			param('candidateRemoteId').isUUID(),
			param('proofId').isInt({ min: 1 }),
			param('proofVersion').isInt({ min: 1 }),
			param('proofEvaluatedAtMs').isInt({
				max: Number.MAX_SAFE_INTEGER,
				min: 1
			}),
			param('contentDigest').matches(/^[0-9a-f]{64}$/i)
		],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return respondObjectUnavailable(res, invalidObjectProof());
			}

			const result = await config.getHistoryArchiveRepairObjectArtifact.execute(
				{
					candidateRemoteId: req.params.candidateRemoteId,
					contentDigest: req.params.contentDigest,
					proofId: req.params.proofId,
					proofEvaluatedAtMs: Number(req.params.proofEvaluatedAtMs),
					proofVersion: Number(req.params.proofVersion),
					targetRemoteId: req.params.targetRemoteId
				}
			);
			if (result.status === 'unavailable') {
				return respondObjectUnavailable(res, result);
			}

			res.status(200);
			res.setHeader('Content-Type', result.mediaType);
			res.setHeader('Content-Length', String(result.byteLength));
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${result.fileName}"`
			);
			res.setHeader('Cache-Control', 'no-store');
			res.setHeader('X-Stellar-Content-SHA256', result.contentDigest);
			res.setHeader(
				'X-Stellar-Content-Representation',
				result.contentRepresentation
			);

			try {
				await pipeline(result.stream, res);
			} catch {
				if (!res.headersSent) {
					return res.status(500).json({ error: 'Internal server error' });
				}
				res.destroy();
			} finally {
				await result.close();
			}
		}
	);

	router.get(
		'/:encodedUrl/repair-plan',
		[
			param('encodedUrl').isURL(),
			query('limit').optional().isInt({ min: 1, max: maxRepairPlanLimit })
		],
		async function (req: express.Request, res: express.Response) {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + planCacheMaxAgeSeconds
			);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const limit =
				typeof req.query.limit === 'string'
					? Number(req.query.limit)
					: undefined;
			const planOrError = await config.getHistoryArchiveRepairPlan.execute({
				limit,
				url: req.params.encodedUrl
			});
			if (planOrError.isErr() && planOrError.error instanceof InvalidUrlError) {
				return res.status(400).json({ error: 'Invalid url' });
			}
			if (planOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(planOrError.value);
		}
	);
}

function respondUnavailable(
	res: express.Response,
	evidence: HistoryArchiveRepairArtifactUnavailableV1
): express.Response {
	res.setHeader('Cache-Control', 'no-store');
	if (evidence.retry.retryable && evidence.retry.afterSeconds !== null) {
		res.setHeader('Retry-After', String(evidence.retry.afterSeconds));
	}
	return res.status(statusForUnavailable(evidence)).json(evidence);
}

function statusForUnavailable(
	evidence: HistoryArchiveRepairArtifactUnavailableV1
): number {
	if (evidence.reason === 'invalid-object-identity') return 400;
	if (evidence.reason === 'local-payload-missing') return 404;
	if (evidence.reason === 'local-payload-too-large') return 413;
	if (evidence.reason === 'verification-busy') return 429;
	if (
		evidence.reason === 'content-hash-mismatch' ||
		evidence.reason === 'invalid-compressed-payload' ||
		evidence.reason === 'local-payload-not-regular'
	) {
		return 409;
	}
	return 503;
}

type ObjectUnavailable = Exclude<
	GetHistoryArchiveRepairObjectArtifactResult,
	{ readonly status: 'available' }
>;

function invalidObjectProof(): ObjectUnavailable {
	return {
		reason: 'proof-no-longer-valid',
		retryAfterSeconds: null,
		retryable: false,
		status: 'unavailable'
	};
}

function respondObjectUnavailable(
	res: express.Response,
	evidence: ObjectUnavailable
): express.Response {
	res.setHeader('Cache-Control', 'no-store');
	if (evidence.retryable && evidence.retryAfterSeconds !== null) {
		res.setHeader('Retry-After', String(evidence.retryAfterSeconds));
	}
	return res.status(statusForObjectUnavailable(evidence.reason)).json(evidence);
}

function statusForObjectUnavailable(
	reason: ObjectUnavailable['reason']
): number {
	if (reason === 'invalid-object-identity') return 400;
	if (reason === 'remote-payload-too-large') return 413;
	if (reason === 'verification-busy') return 429;
	if (
		reason === 'content-hash-mismatch' ||
		reason === 'invalid-compressed-payload' ||
		reason === 'proof-no-longer-valid' ||
		reason === 'remote-response-invalid'
	) {
		return 409;
	}
	if (reason === 'remote-fetch-failed') return 502;
	return 503;
}
