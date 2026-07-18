import type { ScpStatementLiveCursor } from '../../domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservationV1 } from 'shared';

export interface ScpStatementStreamState {
	cursor: ScpStatementLiveCursor | null;
	seenHashes: Set<string>;
	seenHashQueue: string[];
}

export interface BoundedScpStatementDelta {
	readonly hasMore: boolean;
	readonly oversizedStatementHash: string | null;
	readonly statements: ScpStatementObservationV1[];
}

const maxSeenStatementHashes = 2_000;

export const createScpStatementStreamState = (
	cursor: ScpStatementLiveCursor | null = null
): ScpStatementStreamState => ({
	cursor,
	seenHashQueue: [],
	seenHashes: new Set()
});

export const toScpStatementCursor = (
	statement: ScpStatementObservationV1
): ScpStatementLiveCursor | null => {
	const observedAtMs = new Date(statement.observedAt).getTime();
	if (!Number.isFinite(observedAtMs)) return null;
	return { observedAtMs, statementHash: statement.statementHash };
};

export const compareScpStatementCursor = (
	left: ScpStatementLiveCursor,
	right: ScpStatementLiveCursor
): number =>
	left.observedAtMs - right.observedAtMs ||
	left.statementHash.localeCompare(right.statementHash);

export const compareScpStatement = (
	left: ScpStatementObservationV1,
	right: ScpStatementObservationV1
): number => {
	const leftCursor = toScpStatementCursor(left);
	const rightCursor = toScpStatementCursor(right);
	if (leftCursor === null && rightCursor === null) return 0;
	if (leftCursor === null) return 1;
	if (rightCursor === null) return -1;
	return compareScpStatementCursor(leftCursor, rightCursor);
};

export const getScpStatementReadCursor = (
	state: ScpStatementStreamState
): ScpStatementLiveCursor | undefined => state.cursor ?? undefined;

export const getScpStatementReadOrder = (
	state: ScpStatementStreamState
): 'asc' | 'desc' => (state.cursor === null ? 'desc' : 'asc');

export const selectScpStatementDelta = (
	state: ScpStatementStreamState,
	statements: readonly ScpStatementObservationV1[]
): ScpStatementObservationV1[] =>
	selectBoundedScpStatementDelta(state, statements, Number.MAX_SAFE_INTEGER)
		.statements;

export const selectBoundedScpStatementDelta = (
	state: ScpStatementStreamState,
	statements: readonly ScpStatementObservationV1[],
	maxSerializedBytes: number
): BoundedScpStatementDelta => {
	const delta: ScpStatementObservationV1[] = [];
	const byteLimit = Math.max(2, Math.floor(maxSerializedBytes));
	let serializedBytes = 2;
	for (const statement of statements) {
		const cursor = toScpStatementCursor(statement);
		if (cursor === null) continue;
		if (
			state.cursor !== null &&
			compareScpStatementCursor(cursor, state.cursor) <= 0
		) {
			continue;
		}
		if (state.seenHashes.has(statement.statementHash)) continue;

		const statementBytes = Buffer.byteLength(JSON.stringify(statement), 'utf8');
		const candidateBytes =
			serializedBytes + statementBytes + (delta.length === 0 ? 0 : 1);
		if (candidateBytes > byteLimit) {
			return {
				hasMore: true,
				oversizedStatementHash:
					delta.length === 0 ? statement.statementHash : null,
				statements: delta
			};
		}
		serializedBytes = candidateBytes;
		delta.push(statement);
		rememberScpStatementHash(state, statement.statementHash);
		if (
			state.cursor === null ||
			compareScpStatementCursor(state.cursor, cursor) < 0
		) {
			state.cursor = cursor;
		}
	}
	return {
		hasMore: false,
		oversizedStatementHash: null,
		statements: delta
	};
};

const rememberScpStatementHash = (
	state: ScpStatementStreamState,
	statementHash: string
): void => {
	state.seenHashes.add(statementHash);
	state.seenHashQueue.push(statementHash);
	while (state.seenHashQueue.length > maxSeenStatementHashes) {
		const evictedHash = state.seenHashQueue.shift();
		if (evictedHash !== undefined) state.seenHashes.delete(evictedHash);
	}
};
