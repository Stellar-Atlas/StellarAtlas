import type {
	PublicScpGraphStatement,
	PublicScpStatementCursor,
	PublicScpStatementObservation,
	PublicScpStatementReadMetadata
} from './types';

export type PublicScpSemanticEventKind =
	| 'nomination_observed'
	| 'prepare_observed'
	| 'commit_observed'
	| 'externalized';

export interface PublicScpSemanticEvent {
	readonly eventId: string;
	readonly kind: PublicScpSemanticEventKind;
	readonly nodeId: string;
	readonly observedAt: string;
	readonly organizationId: string | null;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statement: PublicScpGraphStatement;
	readonly transactionSetHashes: readonly string[];
}

export interface PublicScpSlotEvidence {
	readonly events: readonly PublicScpSemanticEvent[];
	readonly metadata: PublicScpStatementReadMetadata;
	readonly phaseCounts: Readonly<
		Record<'confirm' | 'externalize' | 'nominate' | 'prepare', number>
	>;
	readonly slotIndex: string;
	readonly statementCount: number;
	readonly validatorCount: number;
}

export interface PublicScpCompactDeliveryMetadata {
	readonly byteLimit: number;
	readonly eventCount: number;
	readonly eventLimit: number;
	readonly nextCursor: string | null;
	readonly serializedBytes: number;
	readonly truncated: boolean;
}

export interface PublicScpLatestSlots {
	readonly delivery?: PublicScpCompactDeliveryMetadata;
	readonly slots: readonly PublicScpSlotEvidence[];
}

export interface PublicScpAnimationBacklog {
	readonly delivery?: PublicScpCompactDeliveryMetadata;
	readonly metadata: PublicScpStatementReadMetadata;
	readonly slots: readonly {
		readonly slotIndex: string;
		readonly statements: readonly PublicScpGraphStatement[];
	}[];
	readonly statementCount: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const count = (value: unknown): value is number =>
	Number.isSafeInteger(value) && Number(value) >= 0;

export function parseScpSlotEvidenceList(
	value: unknown
): PublicScpSlotEvidence[] | null {
	if (!Array.isArray(value)) return null;
	const parsed = value.map(parseScpSlotEvidence);
	return parsed.every((item): item is PublicScpSlotEvidence => item !== null)
		? parsed
		: null;
}

export function parseScpLatestSlots(
	value: unknown
): PublicScpLatestSlots | null {
	if (Array.isArray(value)) {
		const slots = parseScpSlotEvidenceList(value);
		return slots === null ? null : { slots };
	}
	if (!record(value) || !Array.isArray(value.slots)) return null;
	const slots = parseScpSlotEvidenceList(value.slots);
	const delivery = parseCompactDelivery(value.delivery);
	return slots === null || delivery === null ? null : { delivery, slots };
}

export function parseScpAnimationBacklog(
	value: unknown
): PublicScpAnimationBacklog | null {
	if (
		!record(value) ||
		!Array.isArray(value.slots) ||
		!count(value.statementCount)
	)
		return null;
	const metadata = parseMetadata(value.metadata);
	const delivery =
		value.delivery === undefined
			? undefined
			: parseCompactDelivery(value.delivery);
	if (
		metadata === null ||
		delivery === null ||
		(delivery !== undefined && delivery.eventCount !== value.statementCount)
	)
		return null;
	const parsedSlots: Array<PublicScpAnimationBacklog['slots'][number] | null> =
		value.slots.map((slot) => {
			if (
				!record(slot) ||
				!text(slot.slotIndex) ||
				!Array.isArray(slot.statements)
			)
				return null;
			const statements = slot.statements.map((statement) =>
				parseGraphStatement(statement)
			);
			return statements.every(
				(statement): statement is PublicScpGraphStatement => statement !== null
			)
				? { slotIndex: slot.slotIndex, statements }
				: null;
		});
	const slots = parsedSlots.filter(
		(slot): slot is PublicScpAnimationBacklog['slots'][number] => slot !== null
	);
	if (
		slots.length !== parsedSlots.length ||
		slots.reduce((total, slot) => total + slot.statements.length, 0) !==
			value.statementCount
	)
		return null;
	return {
		...(delivery !== undefined ? { delivery } : {}),
		metadata,
		slots,
		statementCount: value.statementCount
	};
}

function parseCompactDelivery(
	value: unknown
): PublicScpCompactDeliveryMetadata | null {
	if (
		!record(value) ||
		!count(value.byteLimit) ||
		!count(value.eventCount) ||
		!count(value.eventLimit) ||
		(value.nextCursor !== null && !text(value.nextCursor)) ||
		!count(value.serializedBytes) ||
		typeof value.truncated !== 'boolean' ||
		value.eventCount > value.eventLimit
	)
		return null;
	return {
		byteLimit: value.byteLimit,
		eventCount: value.eventCount,
		eventLimit: value.eventLimit,
		nextCursor: value.nextCursor,
		serializedBytes: value.serializedBytes,
		truncated: value.truncated
	};
}

function parseScpSlotEvidence(value: unknown): PublicScpSlotEvidence | null {
	if (
		!record(value) ||
		!Array.isArray(value.events) ||
		!record(value.metadata) ||
		!record(value.phaseCounts)
	)
		return null;
	const phaseCounts = value.phaseCounts;
	const events = value.events.map(parseSemanticEvent);
	const metadata = parseMetadata(value.metadata);
	if (
		!events.every((event): event is PublicScpSemanticEvent => event !== null) ||
		!text(value.slotIndex) ||
		!count(value.statementCount) ||
		!count(value.validatorCount) ||
		metadata === null ||
		!['confirm', 'externalize', 'nominate', 'prepare'].every((phase) =>
			count(phaseCounts[phase])
		)
	)
		return null;
	return {
		events,
		metadata,
		phaseCounts: {
			confirm: Number(phaseCounts.confirm),
			externalize: Number(phaseCounts.externalize),
			nominate: Number(phaseCounts.nominate),
			prepare: Number(phaseCounts.prepare)
		},
		slotIndex: value.slotIndex,
		statementCount: value.statementCount,
		validatorCount: value.validatorCount
	};
}

function parseSemanticEvent(value: unknown): PublicScpSemanticEvent | null {
	if (
		!record(value) ||
		!text(value.eventId) ||
		!isKind(value.kind) ||
		!text(value.nodeId) ||
		!text(value.observedAt) ||
		(value.organizationId !== null && !text(value.organizationId)) ||
		!text(value.quorumSetHash) ||
		!text(value.slotIndex) ||
		!Array.isArray(value.transactionSetHashes) ||
		!value.transactionSetHashes.every(text)
	)
		return null;
	const statement = parseGraphStatement(value.statement, value.quorumSetHash);
	if (statement === null) return null;
	return {
		eventId: value.eventId,
		kind: value.kind,
		nodeId: value.nodeId,
		observedAt: value.observedAt,
		organizationId: value.organizationId,
		quorumSetHash: value.quorumSetHash,
		slotIndex: value.slotIndex,
		statement,
		transactionSetHashes: value.transactionSetHashes
	};
}

function parseGraphStatement(
	value: unknown,
	quorumSetHashFallback?: string
): PublicScpGraphStatement | null {
	if (
		!record(value) ||
		!text(value.nodeId) ||
		!text(value.observedAt) ||
		!text(value.observedFromPeer) ||
		!text(value.slotIndex) ||
		!text(value.statementHash) ||
		!isStatementType(value.statementType) ||
		!Array.isArray(value.values)
	)
		return null;
	const quorumSetHash = text(value.quorumSetHash)
		? value.quorumSetHash
		: quorumSetHashFallback;
	if (quorumSetHash === undefined) return null;
	const values = value.values.flatMap((entry) =>
		record(entry) &&
		text(entry.closeTime) &&
		text(entry.txSetHash) &&
		(entry.upgradeCount === undefined || count(entry.upgradeCount)) &&
		(entry.value === undefined || text(entry.value))
			? [
					{
						closeTime: entry.closeTime,
						txSetHash: entry.txSetHash,
						...(entry.upgradeCount !== undefined
							? { upgradeCount: entry.upgradeCount }
							: {}),
						...(entry.value !== undefined ? { value: entry.value } : {})
					}
				]
			: []
	);
	if (values.length !== value.values.length) return null;
	return {
		nodeId: value.nodeId,
		observedAt: value.observedAt,
		observedFromPeer: value.observedFromPeer,
		quorumSetHash,
		slotIndex: value.slotIndex,
		statementHash: value.statementHash,
		statementType: value.statementType,
		values
	};
}

function isStatementType(
	value: unknown
): value is PublicScpStatementObservation['statementType'] {
	return (
		value === 'confirm' ||
		value === 'externalize' ||
		value === 'nominate' ||
		value === 'prepare'
	);
}

function isKind(value: unknown): value is PublicScpSemanticEventKind {
	return (
		value === 'nomination_observed' ||
		value === 'prepare_observed' ||
		value === 'commit_observed' ||
		value === 'externalized'
	);
}

function parseMetadata(value: unknown): PublicScpStatementReadMetadata | null {
	if (
		!record(value) ||
		(value.freshness !== 'fresh' &&
			value.freshness !== 'stale' &&
			value.freshness !== 'empty' &&
			value.freshness !== 'unavailable') ||
		(value.source !== 'meilisearch' && value.source !== 'postgres_canonical') ||
		(value.observedAt !== null && !text(value.observedAt)) ||
		(value.freshnessMs !== null && !count(value.freshnessMs)) ||
		(value.truncated !== undefined && typeof value.truncated !== 'boolean')
	)
		return null;
	const cursor = value.cursor;
	if (
		cursor !== undefined &&
		cursor !== null &&
		(!record(cursor) ||
			!count(cursor.observedAtMs) ||
			!text(cursor.statementHash) ||
			cursor.statementHash.trim().length === 0)
	)
		return null;
	const parsedCursor: PublicScpStatementCursor | null | undefined =
		cursor === undefined
			? undefined
			: cursor === null
				? null
				: {
						observedAtMs: Number(cursor.observedAtMs),
						statementHash: String(cursor.statementHash)
					};
	return {
		...(parsedCursor !== undefined ? { cursor: parsedCursor } : {}),
		freshness: value.freshness,
		freshnessMs: value.freshnessMs,
		observedAt: value.observedAt,
		source: value.source,
		...(value.truncated !== undefined ? { truncated: value.truncated } : {})
	};
}
