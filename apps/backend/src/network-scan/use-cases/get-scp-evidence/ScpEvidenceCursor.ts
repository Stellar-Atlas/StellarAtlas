import type { ScpStatementReadCursor } from '../../domain/scp/ScpStatementObservationRepository.js';

const maximumCursorLength = 512;

export interface ScpCursorStatement {
	readonly observedAt: string;
	readonly statementHash: string;
}

export function encodeScpEvidenceCursor(
	cursor: ScpStatementReadCursor
): string {
	return Buffer.from(
		JSON.stringify([cursor.observedAtMs, cursor.statementHash]),
		'utf8'
	).toString('base64url');
}

export function decodeScpEvidenceCursor(
	value: string
): ScpStatementReadCursor | null {
	if (value.length === 0 || value.length > maximumCursorLength) return null;
	try {
		const decoded: unknown = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		);
		if (!Array.isArray(decoded) || decoded.length !== 2) return null;
		const [observedAtMs, statementHash] = decoded as unknown[];
		if (
			!Number.isSafeInteger(observedAtMs) ||
			Number(observedAtMs) < 0 ||
			typeof statementHash !== 'string' ||
			statementHash.trim().length === 0
		) {
			return null;
		}
		return { observedAtMs: Number(observedAtMs), statementHash };
	} catch {
		return null;
	}
}

export function cursorForStatement(
	statement: ScpCursorStatement
): ScpStatementReadCursor | null {
	const observedAtMs = Date.parse(statement.observedAt);
	return Number.isFinite(observedAtMs)
		? { observedAtMs, statementHash: statement.statementHash }
		: null;
}
