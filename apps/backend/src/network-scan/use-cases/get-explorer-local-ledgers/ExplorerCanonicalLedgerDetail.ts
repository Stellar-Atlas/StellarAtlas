import { getPublicHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import type { FullHistoryCanonicalLedgerView } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalLedger.js';

export interface ExplorerCanonicalLedgerDetailDTO {
	readonly bucketListHash: string;
	readonly closedAt: string;
	readonly evidence: {
		readonly archiveSource: string;
		readonly batchId: string;
		readonly checkpointLedger: string;
		readonly checkpointProofId: number;
		readonly decoderVersion: string;
		readonly proofVersion: number;
		readonly sourceObject: {
			readonly algorithm: 'sha256';
			readonly contentDigest: string;
			readonly objectRemoteId: string;
			readonly representation: 'uncompressed-xdr';
		};
	};
	readonly freshness: {
		readonly ingestedAt: string;
		readonly proofEvaluatedAt: string;
	};
	readonly hash: string;
	readonly operationCount: number;
	readonly previousLedgerHash: string;
	readonly protocolVersion: number;
	readonly sequence: string;
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export function mapExplorerCanonicalLedgerDetail(
	ledger: FullHistoryCanonicalLedgerView
): ExplorerCanonicalLedgerDetailDTO {
	return {
		bucketListHash: ledger.bucketListHash.toHex(),
		closedAt: ledger.closedAt.toISOString(),
		evidence: {
			archiveSource: getPublicHistoryArchiveUrlIdentity(
				ledger.evidence.archiveUrlIdentity
			),
			batchId: ledger.evidence.batchId,
			checkpointLedger: ledger.evidence.checkpointLedger,
			checkpointProofId: ledger.evidence.checkpointProofId,
			decoderVersion: ledger.evidence.decoderVersion,
			proofVersion: ledger.evidence.proofVersion,
			sourceObject: {
				algorithm: 'sha256',
				contentDigest: ledger.evidence.ledgerSourceObject.contentDigest.toHex(),
				objectRemoteId: ledger.evidence.ledgerSourceObject.objectRemoteId,
				representation: 'uncompressed-xdr'
			}
		},
		freshness: {
			ingestedAt: ledger.evidence.ingestedAt.toISOString(),
			proofEvaluatedAt: ledger.evidence.proofEvaluatedAt.toISOString()
		},
		hash: ledger.ledgerHash.toHex(),
		operationCount: ledger.operationCount,
		previousLedgerHash: ledger.previousLedgerHash.toHex(),
		protocolVersion: ledger.protocolVersion,
		sequence: ledger.ledgerSequence,
		source: 'postgres_canonical',
		transactionCount: ledger.transactionCount,
		transactionResultHash: ledger.transactionResultHash.toHex(),
		transactionSetHash: ledger.transactionSetHash.toHex()
	};
}
