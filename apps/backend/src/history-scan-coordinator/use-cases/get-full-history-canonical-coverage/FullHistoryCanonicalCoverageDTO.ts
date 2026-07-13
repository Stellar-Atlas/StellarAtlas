import { getPublicHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import type { FullHistoryCanonicalCoverageView } from '../../domain/full-history/FullHistoryCanonicalRepository.js';

export interface CanonicalFullHistorySourceObjectDTO {
	readonly algorithm: 'sha256';
	readonly contentDigest: string;
	readonly objectRemoteId: string;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export interface CanonicalFullHistoryLatestEvidenceDTO {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly checkpointLedger: string;
	readonly checkpointProofId: number;
	readonly decoderVersion: string;
	readonly firstLedger: string;
	readonly ingestedAt: string;
	readonly lastLedger: string;
	readonly proofEvaluatedAt: string;
	readonly proofVersion: number;
	readonly sourceObjects: {
		readonly checkpointState: CanonicalFullHistorySourceObjectDTO;
		readonly ledger: CanonicalFullHistorySourceObjectDTO;
		readonly results: CanonicalFullHistorySourceObjectDTO;
		readonly transactions: CanonicalFullHistorySourceObjectDTO;
	};
}

export interface CanonicalFullHistoryCoverageDTO {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly latestEvidence: CanonicalFullHistoryLatestEvidenceDTO;
	readonly latestLedgerClosedAt: string;
	readonly ledgerCount: number;
	readonly nextLedger: string;
	readonly rangeKind: 'contiguous_bounded';
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: string;
}

export function mapCanonicalCoverage(
	coverage: FullHistoryCanonicalCoverageView
): CanonicalFullHistoryCoverageDTO {
	const evidence = coverage.latestEvidence;
	return {
		archiveSourceCount: coverage.archiveSourceCount,
		batchCount: coverage.batchCount,
		firstLedger: coverage.firstLedger,
		lastLedger: coverage.lastLedger,
		latestEvidence: {
			archiveUrlIdentity: getPublicHistoryArchiveUrlIdentity(
				evidence.archiveUrlIdentity
			),
			batchId: evidence.batchId,
			checkpointLedger: evidence.checkpointLedger,
			checkpointProofId: evidence.checkpointProofId,
			decoderVersion: evidence.decoderVersion,
			firstLedger: evidence.firstLedger,
			ingestedAt: evidence.ingestedAt.toISOString(),
			lastLedger: evidence.lastLedger,
			proofEvaluatedAt: evidence.proofEvaluatedAt.toISOString(),
			proofVersion: evidence.proofVersion,
			sourceObjects: {
				checkpointState: mapSourceObject(
					evidence.sourceObjects.checkpointState,
					'canonical-json'
				),
				ledger: mapSourceObject(
					evidence.sourceObjects.ledger,
					'uncompressed-xdr'
				),
				results: mapSourceObject(
					evidence.sourceObjects.results,
					'uncompressed-xdr'
				),
				transactions: mapSourceObject(
					evidence.sourceObjects.transactions,
					'uncompressed-xdr'
				)
			}
		},
		latestLedgerClosedAt: coverage.latestLedgerClosedAt.toISOString(),
		ledgerCount: coverage.ledgerCount,
		nextLedger: coverage.nextLedger,
		rangeKind: 'contiguous_bounded',
		source: 'postgres_canonical',
		transactionCount: coverage.transactionCount,
		transactionResultCount: coverage.transactionResultCount,
		updatedAt: coverage.updatedAt.toISOString()
	};
}

function mapSourceObject(
	source: FullHistoryCanonicalCoverageView['latestEvidence']['sourceObjects']['ledger'],
	representation: CanonicalFullHistorySourceObjectDTO['representation']
): CanonicalFullHistorySourceObjectDTO {
	return {
		algorithm: 'sha256',
		contentDigest: source.contentDigest.toHex(),
		objectRemoteId: source.objectRemoteId,
		representation
	};
}
