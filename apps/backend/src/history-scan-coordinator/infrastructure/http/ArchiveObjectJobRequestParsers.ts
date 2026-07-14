import type express from 'express';
import {
	isArchiveMetadataDTO,
	isHistoryArchiveObjectFailureChannelDTO
} from 'history-scanner-dto';
import type { CompleteHistoryArchiveObjectRequest } from '../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectProgressUpdate
} from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

export function parseArchiveObjectProgress(
	req: express.Request,
	res: express.Response
): HistoryArchiveObjectProgressUpdate | null {
	const body = req.body;
	if (!isRecord(body)) {
		res.status(400).json({ error: 'Request body must be an object' });
		return null;
	}
	const claimAttempt = parseClaimAttempt(body, res);
	if (claimAttempt === null) return null;

	const progress: {
		bytesDownloaded?: number | null;
		claimAttempt: number;
		verificationFacts?: object | null;
		workerStage?: string | null;
	} = { claimAttempt };
	if ('bytesDownloaded' in body) {
		const bytesDownloaded = body.bytesDownloaded;
		if (
			bytesDownloaded !== null &&
			(typeof bytesDownloaded !== 'number' ||
				!Number.isSafeInteger(bytesDownloaded) ||
				bytesDownloaded < 0)
		) {
			res.status(400).json({
				error: 'bytesDownloaded must be a non-negative integer or null'
			});
			return null;
		}
		progress.bytesDownloaded = bytesDownloaded;
	}
	if ('workerStage' in body) {
		if (body.workerStage !== null && typeof body.workerStage !== 'string') {
			res.status(400).json({ error: 'workerStage must be a string or null' });
			return null;
		}
		progress.workerStage = body.workerStage;
	}
	if ('verificationFacts' in body) {
		if (
			body.verificationFacts !== null &&
			(typeof body.verificationFacts !== 'object' ||
				Array.isArray(body.verificationFacts))
		) {
			res
				.status(400)
				.json({ error: 'verificationFacts must be an object or null' });
			return null;
		}
		progress.verificationFacts = body.verificationFacts;
	}

	return progress;
}

export function parseArchiveObjectCompletion(
	req: express.Request,
	res: express.Response
): CompleteHistoryArchiveObjectRequest | null {
	const progress = parseArchiveObjectProgress(req, res);
	if (progress === null) return null;
	const body = req.body;
	if (isRecord(body) && 'archiveMetadata' in body) {
		if (!isArchiveMetadataDTO(body.archiveMetadata)) {
			res.status(400).json({ error: 'archiveMetadata is invalid' });
			return null;
		}

		return { ...progress, archiveMetadata: body.archiveMetadata };
	}

	return progress;
}

export function parseArchiveObjectFailure(
	req: express.Request,
	res: express.Response
): HistoryArchiveObjectFailure | null {
	const body = req.body;
	if (!isRecord(body)) {
		res.status(400).json({ error: 'Request body must be an object' });
		return null;
	}
	const claimAttempt = parseClaimAttempt(body, res);
	if (claimAttempt === null) return null;
	if (typeof body.errorType !== 'string' || body.errorType.length === 0) {
		res.status(400).json({ error: 'errorType is required' });
		return null;
	}
	if (typeof body.errorMessage !== 'string' || body.errorMessage.length === 0) {
		res.status(400).json({ error: 'errorMessage is required' });
		return null;
	}
	if (!isHistoryArchiveObjectFailureChannelDTO(body.failureChannel)) {
		res.status(400).json({ error: 'failureChannel is invalid' });
		return null;
	}
	if (
		body.httpStatus !== undefined &&
		body.httpStatus !== null &&
		(typeof body.httpStatus !== 'number' ||
			!Number.isSafeInteger(body.httpStatus))
	) {
		res.status(400).json({ error: 'httpStatus must be an integer or null' });
		return null;
	}
	if (
		body.retryAfterSeconds !== undefined &&
		body.retryAfterSeconds !== null &&
		(typeof body.retryAfterSeconds !== 'number' ||
			!Number.isSafeInteger(body.retryAfterSeconds) ||
			body.retryAfterSeconds < 0)
	) {
		res.status(400).json({
			error: 'retryAfterSeconds must be a non-negative integer or null'
		});
		return null;
	}
	if (
		body.verificationFacts !== undefined &&
		body.verificationFacts !== null &&
		(typeof body.verificationFacts !== 'object' ||
			Array.isArray(body.verificationFacts))
	) {
		res
			.status(400)
			.json({ error: 'verificationFacts must be an object or null' });
		return null;
	}

	return {
		claimAttempt,
		errorMessage: body.errorMessage,
		errorType: body.errorType,
		failureChannel: body.failureChannel,
		httpStatus: body.httpStatus === undefined ? null : body.httpStatus,
		retryAfterSeconds:
			body.retryAfterSeconds === undefined ? null : body.retryAfterSeconds,
		...(body.verificationFacts === undefined
			? {}
			: { verificationFacts: body.verificationFacts })
	};
}

export function parseClaimAttempt(
	body: unknown,
	res: express.Response
): number | null {
	if (!isRecord(body)) {
		res.status(400).json({ error: 'Request body must be an object' });
		return null;
	}
	if (
		typeof body.claimAttempt !== 'number' ||
		!Number.isSafeInteger(body.claimAttempt) ||
		body.claimAttempt < 1
	) {
		res.status(400).json({ error: 'claimAttempt must be a positive integer' });
		return null;
	}

	return body.claimAttempt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
