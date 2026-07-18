import type { ScpStatementObservationV1, ScpStatementTypeV1 } from 'shared';
import type {
	ScpAnimationStatement,
	ScpStatementReadResult
} from '../get-scp-statements/GetScpStatements.js';
import type {
	ScpAnimationSemanticEvent,
	ScpEvidenceMetadata,
	ScpLatestSlotEvidence,
	ScpSemanticEvent,
	ScpSemanticEventKind,
	ScpSlotEvidence
} from './ScpEvidenceDTO.js';

export function groupStatementsBySlot<T extends { readonly slotIndex: string }>(
	statements: readonly T[]
): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const statement of statements) {
		const rows = grouped.get(statement.slotIndex);
		if (rows) rows.push(statement);
		else grouped.set(statement.slotIndex, [statement]);
	}
	return grouped;
}

export function toSlotEvidence(
	slotIndex: string,
	statements: readonly ScpStatementObservationV1[],
	metadata: ScpEvidenceMetadata,
	organizations: ReadonlyMap<string, string>
): ScpSlotEvidence {
	return {
		events: statements.map((statement) =>
			toSemanticEvent(statement, organizations)
		),
		metadata: toEvidenceMetadata(metadata),
		phaseCounts: countPhases(statements),
		slotIndex,
		statementCount: statements.length,
		validatorCount: new Set(statements.map(({ nodeId }) => nodeId)).size
	};
}

export function toAnimationSlotEvidence(
	slotIndex: string,
	statements: readonly ScpAnimationStatement[],
	metadata: ScpEvidenceMetadata,
	organizations: ReadonlyMap<string, string>
): ScpLatestSlotEvidence {
	return {
		events: statements.map((statement) =>
			toAnimationSemanticEvent(statement, organizations)
		),
		metadata: toEvidenceMetadata(metadata),
		phaseCounts: countPhases(statements),
		slotIndex,
		statementCount: statements.length,
		validatorCount: new Set(statements.map(({ nodeId }) => nodeId)).size
	};
}

export function toEvidenceMetadata(
	metadata: Pick<
		ScpStatementReadResult,
		'freshness' | 'freshnessMs' | 'observedAt' | 'source'
	>
): ScpEvidenceMetadata {
	return {
		freshness: metadata.freshness,
		freshnessMs: metadata.freshnessMs,
		observedAt: metadata.observedAt,
		source: metadata.source
	};
}

function countPhases(
	statements: readonly {
		readonly statementType: ScpStatementTypeV1;
	}[]
): Record<ScpStatementTypeV1, number> {
	const counts = { confirm: 0, externalize: 0, nominate: 0, prepare: 0 };
	for (const statement of statements) counts[statement.statementType] += 1;
	return counts;
}

function toAnimationSemanticEvent(
	statement: ScpAnimationStatement,
	organizations: ReadonlyMap<string, string>
): ScpAnimationSemanticEvent {
	return {
		eventId: statement.statementHash,
		kind: semanticEventKind(statement.statementType),
		nodeId: statement.nodeId,
		observedAt: statement.observedAt,
		organizationId: organizations.get(statement.nodeId) ?? null,
		quorumSetHash: statement.quorumSetHash,
		slotIndex: statement.slotIndex,
		statement,
		transactionSetHashes: transactionSetHashes(statement.values)
	};
}

function toSemanticEvent(
	statement: ScpStatementObservationV1,
	organizations: ReadonlyMap<string, string>
): ScpSemanticEvent {
	return {
		eventId: statement.statementHash,
		kind: semanticEventKind(statement.statementType),
		nodeId: statement.nodeId,
		observedAt: statement.observedAt,
		organizationId: organizations.get(statement.nodeId) ?? null,
		quorumSetHash: statement.pledges.quorumSetHash,
		slotIndex: statement.slotIndex,
		statement,
		transactionSetHashes: transactionSetHashes(statement.values)
	};
}

function transactionSetHashes(
	values: readonly { readonly txSetHash: string }[]
): string[] {
	return [...new Set(values.map(({ txSetHash }) => txSetHash).filter(Boolean))];
}

function semanticEventKind(
	statementType: ScpStatementTypeV1
): ScpSemanticEventKind {
	if (statementType === 'nominate') return 'nomination_observed';
	if (statementType === 'prepare') return 'prepare_observed';
	if (statementType === 'confirm') return 'commit_observed';
	return 'externalized';
}
