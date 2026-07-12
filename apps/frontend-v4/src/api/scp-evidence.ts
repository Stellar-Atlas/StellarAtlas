import type {
	PublicScpGraphStatement,
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

export interface PublicScpAnimationBacklog {
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

export function parseScpAnimationBacklog(
	value: unknown
): PublicScpAnimationBacklog | null {
	if (
		!record(value) ||
		!record(value.metadata) ||
		!isMetadata(value.metadata) ||
		!Array.isArray(value.slots) ||
		!count(value.statementCount)
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
			const statements = slot.statements.map(parseGraphStatement);
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
		metadata: value.metadata,
		slots,
		statementCount: value.statementCount
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
	if (
		!events.every((event): event is PublicScpSemanticEvent => event !== null) ||
		!text(value.slotIndex) ||
		!count(value.statementCount) ||
		!count(value.validatorCount) ||
		!isMetadata(value.metadata) ||
		!['confirm', 'externalize', 'nominate', 'prepare'].every((phase) =>
			count(phaseCounts[phase])
		)
	)
		return null;
	return {
		events,
		metadata: value.metadata,
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
	const statement = parseGraphStatement(value.statement);
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

function parseGraphStatement(value: unknown): PublicScpGraphStatement | null {
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
	const values = value.values.flatMap((entry) =>
		record(entry) && text(entry.closeTime) && text(entry.txSetHash)
			? [{ closeTime: entry.closeTime, txSetHash: entry.txSetHash }]
			: []
	);
	if (values.length !== value.values.length) return null;
	return {
		nodeId: value.nodeId,
		observedAt: value.observedAt,
		observedFromPeer: value.observedFromPeer,
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

function isMetadata(
	value: Record<string, unknown>
): value is Record<string, unknown> & PublicScpStatementReadMetadata {
	return (
		(value.freshness === 'fresh' ||
			value.freshness === 'stale' ||
			value.freshness === 'empty' ||
			value.freshness === 'unavailable') &&
		(value.source === 'meilisearch' || value.source === 'postgres_canonical') &&
		(value.observedAt === null || text(value.observedAt)) &&
		(value.freshnessMs === null || count(value.freshnessMs))
	);
}
