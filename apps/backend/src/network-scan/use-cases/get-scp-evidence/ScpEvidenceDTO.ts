import type { ScpStatementObservationV1, ScpStatementTypeV1 } from 'shared';
import type {
	ScpAnimationStatement,
	ScpStatementReadFreshness,
	ScpStatementReadSource
} from '../get-scp-statements/GetScpStatements.js';

export type ScpSemanticEventKind =
	| 'nomination_observed'
	| 'prepare_observed'
	| 'commit_observed'
	| 'externalized';

export interface ScpEvidenceMetadata {
	readonly freshness: ScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observedAt: string | null;
	readonly source: ScpStatementReadSource;
}

export interface ScpCompactDeliveryMetadata {
	readonly byteLimit: number;
	readonly eventCount: number;
	readonly eventLimit: number;
	readonly nextCursor: string | null;
	readonly serializedBytes: number;
	readonly truncated: boolean;
}

export interface ScpSemanticEvent {
	readonly eventId: string;
	readonly kind: ScpSemanticEventKind;
	readonly nodeId: string;
	readonly observedAt: string;
	readonly organizationId: string | null;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statement: ScpStatementObservationV1;
	readonly transactionSetHashes: readonly string[];
}

export interface ScpAnimationSemanticEvent {
	readonly eventId: string;
	readonly kind: ScpSemanticEventKind;
	readonly nodeId: string;
	readonly observedAt: string;
	readonly organizationId: string | null;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statement: ScpAnimationStatement;
	readonly transactionSetHashes: readonly string[];
}

export interface ScpSlotEvidence {
	readonly events: readonly ScpSemanticEvent[];
	readonly metadata: ScpEvidenceMetadata;
	readonly phaseCounts: Record<ScpStatementTypeV1, number>;
	readonly slotIndex: string;
	readonly statementCount: number;
	readonly validatorCount: number;
}

export interface ScpLatestSlotEvidence {
	readonly events: readonly ScpAnimationSemanticEvent[];
	readonly metadata: ScpEvidenceMetadata;
	readonly phaseCounts: Record<ScpStatementTypeV1, number>;
	readonly slotIndex: string;
	readonly statementCount: number;
	readonly validatorCount: number;
}

export interface ScpLatestSlots {
	readonly delivery: ScpCompactDeliveryMetadata;
	readonly slots: readonly ScpLatestSlotEvidence[];
}

export interface ScpAnimationBacklog {
	readonly delivery: ScpCompactDeliveryMetadata;
	readonly metadata: ScpEvidenceMetadata;
	readonly slots: readonly {
		readonly slotIndex: string;
		readonly statements: readonly ScpAnimationStatement[];
	}[];
	readonly statementCount: number;
}

export interface ScpEvidencePageMetadata {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly nextCursor: string | null;
}

export interface ScpEvidencePage {
	readonly metadata: ScpEvidenceMetadata;
	readonly page: ScpEvidencePageMetadata;
	readonly slots: readonly ScpSlotEvidence[];
	readonly statementCount: number;
}
