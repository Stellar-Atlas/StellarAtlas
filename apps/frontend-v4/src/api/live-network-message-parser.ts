import type {
	PublicLatestLedger,
	PublicNetwork,
	PublicScpStatementCursor,
	PublicScpStatementObservation,
	PublicScpStatementReadMetadata
} from './types';
import { isPublicNetwork, isRecord } from './live-network-payload-guards';

export type LiveNetworkMessage =
	| {
			cursor?: PublicScpStatementCursor | null;
			payload: { readonly observedAt: string };
			type: 'heartbeat';
	  }
	| { payload: PublicLatestLedger; type: 'latestLedger' }
	| { payload: PublicNetwork; type: 'network' }
	| (PublicScpStatementReadMetadata & {
			payload: PublicScpStatementObservation[];
			type: 'scp';
	  })
	| { payload: { message: string }; type: 'error' };

export const parseLiveNetworkMessage = (
	value: unknown
): LiveNetworkMessage | null => {
	if (!isRecord(value)) return null;
	if (value.type === 'network' && isPublicNetwork(value.payload)) {
		return { payload: value.payload, type: 'network' };
	}
	if (value.type === 'latestLedger') {
		const payload = parseLatestLedger(value.payload);
		return payload === null ? null : { payload, type: 'latestLedger' };
	}
	if (value.type === 'heartbeat') return parseHeartbeatMessage(value);
	if (value.type === 'scp') return parseScpMessage(value);
	if (
		value.type === 'error' &&
		isRecord(value.payload) &&
		typeof value.payload.message === 'string'
	) {
		return { payload: { message: value.payload.message }, type: 'error' };
	}
	return null;
};

const parseHeartbeatMessage = (
	value: Record<string, unknown>
): LiveNetworkMessage | null => {
	const payload = isRecord(value.payload) ? value.payload : {};
	const observedAt = [
		payload.observedAt,
		payload.sentAt,
		payload.timestamp,
		value.observedAt
	].find(isDateString);
	const cursorValue =
		value.cursor !== undefined ? value.cursor : payload.cursor;
	if (observedAt === undefined || !isOptionalScpCursor(cursorValue))
		return null;
	return {
		...(cursorValue !== undefined ? { cursor: cursorValue } : {}),
		payload: { observedAt },
		type: 'heartbeat'
	};
};

const parseLatestLedger = (value: unknown): PublicLatestLedger | null => {
	if (
		!isRecord(value) ||
		!isDateString(value.closedAt) ||
		(value.protocolVersion !== null && !isNumber(value.protocolVersion)) ||
		typeof value.sequence !== 'string'
	) {
		return null;
	}
	if (
		value.freshness !== undefined &&
		value.freshness !== 'fresh' &&
		value.freshness !== 'stale'
	) {
		return null;
	}
	if (!isOptionalNonnegativeNumber(value.freshnessMs)) return null;
	if (value.observedAt !== undefined && !isDateString(value.observedAt)) {
		return null;
	}
	if (
		value.source !== undefined &&
		value.source !== 'horizon_fallback' &&
		value.source !== 'network_scan' &&
		value.source !== 'scp_live_collector'
	) {
		return null;
	}
	return {
		closedAt: value.closedAt,
		freshness: value.freshness,
		freshnessMs: value.freshnessMs,
		observedAt: value.observedAt,
		protocolVersion: value.protocolVersion,
		sequence: value.sequence,
		source: value.source
	};
};

const parseScpMessage = (
	value: Record<string, unknown>
): LiveNetworkMessage | null => {
	const metadata = parseScpMetadata(value);
	if (metadata === null || !Array.isArray(value.payload)) return null;
	const payload: PublicScpStatementObservation[] = [];
	for (const entry of value.payload) {
		const statement = parseScpStatement(entry);
		if (statement === null) return null;
		payload.push(statement);
	}
	if (
		payload.length > 0 &&
		(metadata.freshness === 'empty' || metadata.freshness === 'unavailable')
	) {
		return null;
	}
	if (
		metadata.freshness === 'fresh' &&
		(metadata.freshnessMs === null || metadata.observedAt === null)
	) {
		return null;
	}
	if (
		(metadata.freshness === 'empty' || metadata.freshness === 'unavailable') &&
		(metadata.freshnessMs !== null || metadata.observedAt !== null)
	) {
		return null;
	}
	return { ...metadata, payload, type: 'scp' };
};

const parseScpMetadata = (
	value: Record<string, unknown>
): PublicScpStatementReadMetadata | null => {
	if (
		value.freshness !== 'empty' &&
		value.freshness !== 'fresh' &&
		value.freshness !== 'stale' &&
		value.freshness !== 'unavailable'
	) {
		return null;
	}
	if (value.source !== 'meilisearch' && value.source !== 'postgres_canonical') {
		return null;
	}
	if (!isNullableNonnegativeNumber(value.freshnessMs)) return null;
	if (value.observedAt !== null && !isDateString(value.observedAt)) return null;
	if (!isOptionalScpCursor(value.cursor)) return null;
	if (value.truncated !== undefined && typeof value.truncated !== 'boolean') {
		return null;
	}
	return {
		...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
		freshness: value.freshness,
		freshnessMs: value.freshnessMs,
		observedAt: value.observedAt,
		source: value.source,
		...(value.truncated !== undefined ? { truncated: value.truncated } : {})
	};
};

export const parseScpStatement = (
	value: unknown
): PublicScpStatementObservation | null => {
	if (!isRecord(value) || !isStatementType(value.statementType)) return null;
	if (
		typeof value.nodeId !== 'string' ||
		typeof value.observedAt !== 'string' ||
		typeof value.observedFromAddress !== 'string' ||
		typeof value.observedFromPeer !== 'string' ||
		typeof value.signature !== 'string' ||
		typeof value.slotIndex !== 'string' ||
		typeof value.statementHash !== 'string' ||
		typeof value.statementXdr !== 'string'
	) {
		return null;
	}
	const pledges = parsePledges(value.statementType, value.pledges);
	const values = parseStatementValues(value.values);
	if (pledges === null || values === null) return null;
	return {
		nodeId: value.nodeId,
		observedAt: value.observedAt,
		observedFromAddress: value.observedFromAddress,
		observedFromPeer: value.observedFromPeer,
		pledges,
		signature: value.signature,
		slotIndex: value.slotIndex,
		statementHash: value.statementHash,
		statementType: value.statementType,
		statementXdr: value.statementXdr,
		values
	};
};

const parsePledges = (
	type: PublicScpStatementObservation['statementType'],
	value: unknown
): PublicScpStatementObservation['pledges'] | null => {
	if (!isRecord(value) || typeof value.quorumSetHash !== 'string') return null;
	if (type === 'nominate') {
		if (!isStringArray(value.accepted) || !isStringArray(value.votes))
			return null;
		return {
			accepted: value.accepted,
			quorumSetHash: value.quorumSetHash,
			votes: value.votes
		};
	}
	if (type === 'externalize') {
		const commit = parseBallot(value.commit);
		if (commit === null || !isNumber(value.nH)) return null;
		return { commit, nH: value.nH, quorumSetHash: value.quorumSetHash };
	}
	const ballot = parseBallot(value.ballot);
	if (ballot === null || !isNumber(value.nH)) return null;
	if (type === 'confirm') {
		if (!isNumber(value.nCommit) || !isNumber(value.nPrepared)) return null;
		return {
			ballot,
			nCommit: value.nCommit,
			nH: value.nH,
			nPrepared: value.nPrepared,
			quorumSetHash: value.quorumSetHash
		};
	}
	const prepared = parseNullableBallot(value.prepared);
	const preparedPrime = parseNullableBallot(value.preparedPrime);
	if (
		prepared === undefined ||
		preparedPrime === undefined ||
		!isNumber(value.nC)
	) {
		return null;
	}
	return {
		ballot,
		nC: value.nC,
		nH: value.nH,
		prepared,
		preparedPrime,
		quorumSetHash: value.quorumSetHash
	};
};

const parseBallot = (
	value: unknown
): { counter: number; value: string } | null =>
	isRecord(value) && isNumber(value.counter) && typeof value.value === 'string'
		? { counter: value.counter, value: value.value }
		: null;

const parseNullableBallot = (
	value: unknown
): { counter: number; value: string } | null | undefined =>
	value === null ? null : (parseBallot(value) ?? undefined);

const parseStatementValues = (
	value: unknown
): PublicScpStatementObservation['values'] | null => {
	if (!Array.isArray(value)) return null;
	const parsed: PublicScpStatementObservation['values'] = [];
	for (const entry of value) {
		if (
			!isRecord(entry) ||
			typeof entry.closeTime !== 'string' ||
			typeof entry.txSetHash !== 'string' ||
			!isNumber(entry.upgradeCount) ||
			typeof entry.value !== 'string'
		) {
			return null;
		}
		parsed.push({
			closeTime: entry.closeTime,
			txSetHash: entry.txSetHash,
			upgradeCount: entry.upgradeCount,
			value: entry.value
		});
	}
	return parsed;
};

const isStatementType = (
	value: unknown
): value is PublicScpStatementObservation['statementType'] =>
	value === 'confirm' ||
	value === 'externalize' ||
	value === 'nominate' ||
	value === 'prepare';

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const isOptionalNonnegativeNumber = (
	value: unknown
): value is number | undefined =>
	value === undefined || (isNumber(value) && value >= 0);

const isNullableNonnegativeNumber = (value: unknown): value is number | null =>
	value === null || (isNumber(value) && value >= 0);

const isOptionalScpCursor = (
	value: unknown
): value is PublicScpStatementCursor | null | undefined =>
	value === undefined ||
	value === null ||
	(isRecord(value) &&
		Number.isSafeInteger(value.observedAtMs) &&
		Number(value.observedAtMs) >= 0 &&
		typeof value.statementHash === 'string' &&
		value.statementHash.trim().length > 0);

const isDateString = (value: unknown): value is string =>
	typeof value === 'string' && Number.isFinite(Date.parse(value));
