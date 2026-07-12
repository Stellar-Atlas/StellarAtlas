import type {
	FullHistoryHash,
	FullHistoryLedgerSequence
} from '../full-history/FullHistoryCanonicalTypes.js';

export interface FullHistoryPromotionTarget {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
	readonly networkPassphrase: string;
}

export interface FullHistoryCandidateSourceObject {
	readonly contentDigest: FullHistoryHash;
	readonly remoteId: string;
}

export interface FullHistoryCandidateSources {
	readonly checkpointState: FullHistoryCandidateSourceObject;
	readonly ledger: FullHistoryCandidateSourceObject;
	readonly results: FullHistoryCandidateSourceObject;
	readonly transactions: FullHistoryCandidateSourceObject;
}

export interface FullHistoryCandidateProof {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: FullHistoryLedgerSequence;
	readonly evaluatedAt: Date;
	readonly id: number;
	readonly networkPassphrase: string;
	readonly sources: FullHistoryCandidateSources;
	readonly version: number;
}

export interface FullHistoryCandidateLedger {
	readonly bucketListHash: FullHistoryHash;
	readonly closedAt: Date;
	readonly ledgerHash: FullHistoryHash;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly previousLedgerHash: FullHistoryHash;
	readonly protocolVersion: number;
	readonly transactionResultHash: FullHistoryHash;
	readonly transactionSetHash: FullHistoryHash;
}

export interface FullHistoryCandidateEnvelope {
	readonly envelopeXdr: string;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly transactionIndex: number;
	readonly transactionSetHash: FullHistoryHash;
}

export interface FullHistoryCandidateResult {
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly resultXdr: string;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
	readonly transactionResultHash: FullHistoryHash;
}

export interface FullHistoryCheckpointCandidate {
	readonly envelopes: readonly FullHistoryCandidateEnvelope[];
	readonly ledgers: readonly FullHistoryCandidateLedger[];
	readonly proof: FullHistoryCandidateProof;
	readonly results: readonly FullHistoryCandidateResult[];
}
