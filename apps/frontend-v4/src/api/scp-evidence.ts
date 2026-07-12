import type {
	PublicScpStatementObservation,
	PublicScpStatementReadMetadata
} from './types';
import { parseScpStatement } from './live-network-message-parser';

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
	readonly statement: PublicScpStatementObservation;
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
	const statement = parseScpStatement(value.statement);
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
