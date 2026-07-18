import { Router, type Request } from 'express';
import type { GetScpEvidence } from '../../use-cases/get-scp-evidence/GetScpEvidence.js';
import { decodeScpEvidenceCursor } from '../../use-cases/get-scp-evidence/ScpEvidenceCursor.js';
import type { ScpStatementReadCursor } from '../../domain/scp/ScpStatementObservationRepository.js';
import type { Result } from 'neverthrow';

export function scpEvidenceRouter(getScpEvidence: GetScpEvidence): Router {
	const router = Router();
	router.get('/slots', async (req, res) => {
		const limit = parseLimit(req.query.limit, 12, 25);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid slot limit' });
		return send(await getScpEvidence.getLatestSlots(limit), res);
	});
	router.get('/animation-backlog', async (req, res) => {
		const limit = parseLimit(req.query.limit, 4, 25);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid slot limit' });
		return send(await getScpEvidence.getAnimationBacklog(limit), res);
	});
	router.get('/slots/:slotIndex', async (req, res) => {
		if (!/^\d+$/.test(req.params.slotIndex))
			return res.status(400).json({ error: 'Invalid slot' });
		const limit = parseLimit(req.query.limit, 1000, 1000);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid evidence limit' });
		const cursor = parseCursor(req.query.cursor);
		if (!cursor.isValid)
			return res.status(400).json({ error: 'Invalid evidence cursor' });
		return send(
			await getScpEvidence.getSlot(req.params.slotIndex, limit, cursor.value),
			res
		);
	});
	router.get('/validators/:nodeId', async (req, res) => {
		const limit = parseLimit(req.query.limit, 200, 1000);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid evidence limit' });
		const cursor = parseCursor(req.query.cursor);
		if (!cursor.isValid)
			return res.status(400).json({ error: 'Invalid evidence cursor' });
		return send(
			await getScpEvidence.getValidator(req.params.nodeId, limit, cursor.value),
			res
		);
	});
	router.get('/organizations/:organizationId', async (req, res) => {
		const limit = parseLimit(req.query.limit, 500, 1000);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid evidence limit' });
		const cursor = parseCursor(req.query.cursor);
		if (!cursor.isValid)
			return res.status(400).json({ error: 'Invalid evidence cursor' });
		return send(
			await getScpEvidence.getOrganization(
				req.params.organizationId,
				limit,
				cursor.value
			),
			res
		);
	});
	return router;
}

function parseCursor(
	value: Request['query'][string]
):
	| { readonly isValid: true; readonly value?: ScpStatementReadCursor }
	| { readonly isValid: false } {
	if (value === undefined) return { isValid: true };
	if (typeof value !== 'string') return { isValid: false };
	const cursor = decodeScpEvidenceCursor(value);
	return cursor === null
		? { isValid: false }
		: { isValid: true, value: cursor };
}

function parseLimit(
	value: Request['query'][string],
	fallback: number,
	maximum: number
): number | null {
	if (value === undefined) return fallback;
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
		? parsed
		: null;
}

function send(
	result: Result<unknown, Error>,
	response: import('express').Response
) {
	return result.isErr()
		? response.status(500).json({ error: 'SCP evidence unavailable' })
		: response.json(result.value);
}
