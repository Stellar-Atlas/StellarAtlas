import type * as express from 'express';
import type {
	ScpStatementLiveCursor,
	ScpStatementLiveOrder
} from '../../domain/scp/ScpStatementLiveStore.js';
import type { GetScpStatements } from '../../use-cases/get-scp-statements/GetScpStatements.js';
import type { ScpStatementSource } from '../../use-cases/get-scp-statements/GetScpStatementsDTO.js';

const isLedgerSequence = (value: string): boolean => /^\d+$/.test(value);

const getOptionalString = (
	value: express.Request['query'][string]
): string | undefined => (typeof value === 'string' ? value : undefined);

const getOptionalLimit = (
	value: express.Request['query'][string]
): number | undefined => {
	if (typeof value !== 'string') return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const isScpStatementSource = (
	value: string | undefined
): value is ScpStatementSource =>
	value === 'auto' || value === 'live' || value === 'stored';

const isScpStatementOrder = (
	value: string | undefined
): value is ScpStatementLiveOrder => value === 'asc' || value === 'desc';

const getScpCursor = (
	req: express.Request
):
	| { cursor?: ScpStatementLiveCursor; isValid: true }
	| { isValid: false } => {
	const observedAtMs = getOptionalString(req.query.afterObservedAtMs);
	const statementHash = getOptionalString(req.query.afterStatementHash);
	if (observedAtMs === undefined && statementHash === undefined) {
		return { isValid: true };
	}
	if (observedAtMs === undefined || statementHash === undefined) {
		return { isValid: false };
	}

	const parsedObservedAtMs = Number(observedAtMs);
	if (
		!Number.isSafeInteger(parsedObservedAtMs) ||
		parsedObservedAtMs < 0 ||
		statementHash.trim().length === 0
	) {
		return { isValid: false };
	}

	return {
		cursor: {
			observedAtMs: parsedObservedAtMs,
			statementHash
		},
		isValid: true
	};
};

export const handleScpStatementsRequest = async (
	req: express.Request,
	res: express.Response,
	getScpStatements: GetScpStatements
): Promise<express.Response> => {
	res.setHeader('Cache-Control', 'public, max-age=' + 5);
	res.setHeader('Content-Type', 'application/json');

	const source = getOptionalString(req.query.source);
	if (source !== undefined && !isScpStatementSource(source)) {
		return res.status(400).json({ error: 'Invalid SCP statement source' });
	}
	const order = getOptionalString(req.query.order);
	if (order !== undefined && !isScpStatementOrder(order)) {
		return res.status(400).json({ error: 'Invalid SCP statement order' });
	}
	const slotIndex = getOptionalString(req.query.slotIndex);
	if (slotIndex !== undefined && !isLedgerSequence(slotIndex)) {
		return res.status(400).json({ error: 'Invalid SCP statement slot' });
	}
	const cursor = getScpCursor(req);
	if (!cursor.isValid) {
		return res.status(400).json({ error: 'Invalid SCP statement cursor' });
	}

	const statementsOrError = await getScpStatements.execute({
		after: cursor.cursor,
		limit: getOptionalLimit(req.query.limit),
		nodeId: getOptionalString(req.query.nodeId),
		order,
		slotIndex,
		source
	});

	if (statementsOrError.isErr()) {
		return res.status(500).send('Internal Server Error');
	}

	return res.status(200).send(statementsOrError.value);
};
