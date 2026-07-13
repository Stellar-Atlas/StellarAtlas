export interface PublicCanonicalSourceObjectEvidence {
	readonly algorithm: 'sha256';
	readonly contentDigest: string;
	readonly objectRemoteId: string;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export interface PublicCanonicalLatestEvidence {
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
		readonly checkpointState: PublicCanonicalSourceObjectEvidence;
		readonly ledger: PublicCanonicalSourceObjectEvidence;
		readonly results: PublicCanonicalSourceObjectEvidence;
		readonly transactions: PublicCanonicalSourceObjectEvidence;
	};
}

export interface PublicCanonicalFullHistoryCoverage {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly latestEvidence: PublicCanonicalLatestEvidence | null;
	readonly latestLedgerClosedAt: string;
	readonly ledgerCount: number;
	readonly nextLedger: string;
	readonly rangeKind: 'contiguous_bounded';
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: string;
}
