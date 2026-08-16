import type {
	HistoryArchiveObjectEvidenceClassV1,
	HistoryArchiveObjectFailureClassV1
} from './history-archive-object-summary-v1.js';
import type {
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1
} from './history-archive-object-v1.js';

export type HistoryArchiveRepairActionKindV1 =
	| 'restore-history-archive-state'
	| 'replace-archive-file'
	| 'replace-bucket-file'
	| 'repair-checkpoint-proof'
	| 'wait-for-scanner-proof';

export type HistoryArchiveRepairActionSeverityV1 =
	'error' | 'warning' | 'blocked';

export type HistoryArchiveRepairReasonV1 =
	| 'access-denied'
	| 'archive-object-failed'
	| 'bucket-hash-mismatch'
	| 'bucket-missing'
	| 'checkpoint-ledger-mismatch'
	| 'checkpoint-bucket-list-mismatch'
	| 'history-archive-state-missing'
	| 'http-error'
	| 'missing-object'
	| 'object-failed'
	| 'object-incomplete'
	| 'previous-ledger-hash-mismatch'
	| 'proof-facts-incomplete'
	| 'rate-limited'
	| 'result-hash-mismatch'
	| 'scanner-infrastructure'
	| 'transaction-hash-mismatch'
	| 'transport-error';

export interface HistoryArchiveRepairObjectEvidenceV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | null;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClassV1;
	readonly errorMessage: string | null;
	readonly errorType: string | null;
	readonly failureClass: HistoryArchiveObjectFailureClassV1;
	readonly httpStatus: number | null;
	readonly nextAttemptAt: string | null;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectTypeV1;
	readonly objectUrl: string;
	readonly observedCheckpointLedger: number | null;
	readonly remoteId: string;
	readonly status: HistoryArchiveObjectStatusV1;
	readonly updatedAt: string;
}

export interface HistoryArchiveRepairSourceCandidateV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly objectUrl: string;
	readonly proof: HistoryArchiveRepairSourceProofV1;
	readonly verifiedAt: string | null;
}

export interface HistoryArchiveRepairSourceProofV1 {
	readonly anchor: {
		readonly kind:
			'content-addressed-bucket' | 'multi-source' | 'target-digest';
		readonly sourceCount: number;
	};
	readonly candidateObjectRemoteId: string;
	readonly checkpointLedger: number;
	readonly contentHash: {
		readonly algorithm: 'sha256';
		readonly digest: string;
		readonly representation: 'canonical-json' | 'uncompressed-xdr';
	};
	readonly evaluatedAt: string;
	readonly kind: 'strict-checkpoint';
	readonly proofId: string;
	readonly proofVersion: number;
}

export type HistoryArchiveRepairArtifactUnavailableReasonV1 =
	| 'content-hash-mismatch'
	| 'invalid-compressed-payload'
	| 'invalid-object-identity'
	| 'local-payload-missing'
	| 'local-payload-not-regular'
	| 'local-payload-too-large'
	| 'local-storage-unavailable'
	| 'verification-busy'
	| 'verification-deferred'
	| 'verification-timeout';

export interface HistoryArchiveRepairArtifactContentHashV1 {
	readonly algorithm: 'sha256';
	readonly digest: string;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export interface HistoryArchiveRepairArtifactAvailableV1 {
	readonly artifactType: 'bucket';
	readonly byteLength: number;
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1;
	readonly downloadUrl: string;
	readonly mediaType: 'application/gzip';
	readonly objectIdentity: string;
	readonly provenAt: string;
	readonly status: 'available';
}

export interface HistoryArchiveRepairArtifactVerifyOnDownloadV1 {
	readonly artifactType: HistoryArchiveObjectTypeV1;
	readonly byteLength: number | null;
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1;
	readonly downloadUrl: string;
	readonly mediaType: 'application/gzip' | 'application/json';
	readonly objectIdentity: string;
	readonly provenAt: string;
	readonly status: 'verify-on-download';
}

export interface HistoryArchiveRepairArtifactUnavailableV1 {
	readonly artifactType: 'bucket';
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1 | null;
	readonly objectIdentity: string | null;
	readonly reason: HistoryArchiveRepairArtifactUnavailableReasonV1;
	readonly retry: {
		readonly afterSeconds: number | null;
		readonly retryable: boolean;
	};
	readonly status: 'unavailable';
}

export type HistoryArchiveRepairArtifactAvailabilityV1 =
	| HistoryArchiveRepairArtifactAvailableV1
	| HistoryArchiveRepairArtifactVerifyOnDownloadV1
	| HistoryArchiveRepairArtifactUnavailableV1;

export type HistoryArchiveRepairManifestStatusV1 =
	'ready' | 'awaiting-verified-replacement';

export type HistoryArchiveRepairManifestStepKindV1 =
	| 'backup-current-file'
	| 'stage-replacement'
	| 'verify-staged-content'
	| 'atomic-replace'
	| 'preserve-metadata'
	| 'request-recheck';

export interface HistoryArchiveRepairManifestReplacementV1 {
	readonly artifact:
		| HistoryArchiveRepairArtifactAvailableV1
		| HistoryArchiveRepairArtifactVerifyOnDownloadV1;
	readonly source: HistoryArchiveRepairSourceCandidateV1;
}

export type HistoryArchiveRepairManifestStepV1 =
	| {
			readonly backupSuffix: string;
			readonly kind: 'backup-current-file';
			readonly order: 1;
			/** False only when the observed target is missing; an unexpected file still stops repair. */
			readonly required: boolean;
	  }
	| {
			readonly input: 'replacement-download-url';
			readonly kind: 'stage-replacement';
			readonly order: 2;
			readonly required: true;
			readonly stagingLocation: 'same-filesystem-temporary-file';
	  }
	| {
			readonly expectedContentHash: HistoryArchiveRepairArtifactContentHashV1;
			readonly kind: 'verify-staged-content';
			readonly order: 3;
			readonly required: true;
	  }
	| {
			readonly kind: 'preserve-metadata';
			readonly order: 4;
			readonly preserve: readonly ['owner', 'mode', 'acl'];
			readonly required: true;
	  }
	| {
			readonly kind: 'atomic-replace';
			readonly order: 5;
			readonly required: true;
			readonly requiresSameFilesystem: true;
	  }
	| {
			readonly kind: 'request-recheck';
			readonly order: 6;
			readonly required: true;
			readonly resolutionCondition: 'same-object-verified-after-original-evidence';
	  };

export interface HistoryArchiveRepairManifestV1 {
	readonly actionId: string;
	readonly evidence: HistoryArchiveRepairObjectEvidenceV1;
	readonly generatedAt: string;
	readonly recheck: {
		readonly endpoint: string;
		readonly minimumEvidenceUpdatedAt: string;
		readonly resolutionCondition: 'same-object-verified-after-original-evidence';
		readonly targetRemoteId: string;
	};
	readonly replacement: HistoryArchiveRepairManifestReplacementV1 | null;
	readonly schemaVersion: 1;
	readonly status: HistoryArchiveRepairManifestStatusV1;
	readonly steps: readonly HistoryArchiveRepairManifestStepV1[];
	readonly target: {
		readonly archiveUrl: string;
		readonly archiveUrlIdentity: string;
		readonly bucketHash: string | null;
		readonly checkpointLedger: number | null;
		readonly objectKey: string;
		readonly objectType: HistoryArchiveObjectTypeV1;
		readonly objectUrl: string;
		readonly operatorTargetPathRequired: true;
	};
}

export interface HistoryArchiveCheckpointRepairEvidenceV1 {
	readonly bucketsVerified: boolean;
	readonly checkpointBucketListHash: string | null;
	readonly checkpointBucketListMatches: boolean;
	readonly checkpointLedger: number;
	readonly expectedBucketCount: number;
	readonly failedBucketCount: number;
	readonly failureKind: string | null;
	readonly ledgerBucketListHash: string | null;
	readonly missingBucketCount: number;
	readonly previousLedgersMatch: boolean;
	readonly proofFactsComplete: boolean;
	readonly requiredObjectsComplete: boolean;
	readonly resultsMatch: boolean;
	readonly status: 'pending' | 'verified' | 'mismatch' | 'not-evaluable';
	readonly transactionFactCount: number;
	readonly transactionsMatch: boolean;
	readonly verifiedBucketCount: number;
}

export interface HistoryArchiveRepairActionV1 {
	readonly actionId: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | null;
	readonly evidence: readonly HistoryArchiveRepairObjectEvidenceV1[];
	readonly kind: HistoryArchiveRepairActionKindV1;
	readonly knownGoodSources: readonly HistoryArchiveRepairSourceCandidateV1[];
	/** Non-null for recognized integrity evidence or proof-gated missing 404/410 evidence. */
	readonly repairManifest: HistoryArchiveRepairManifestV1 | null;
	readonly reason: HistoryArchiveRepairReasonV1;
	readonly repairArtifact: HistoryArchiveRepairArtifactAvailabilityV1 | null;
	readonly severity: HistoryArchiveRepairActionSeverityV1;
	readonly summary: string;
	readonly checkpointEvidence: readonly HistoryArchiveCheckpointRepairEvidenceV1[];
}

export interface HistoryArchiveRepairInfrastructureBlockV1 {
	readonly archiveUrlIdentity: string;
	readonly blockedUntil: string | null;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClassV1;
	readonly failureClass: HistoryArchiveObjectFailureClassV1;
	readonly hostIdentity: string;
	readonly httpStatus: number | null;
	readonly summary: string;
}

export interface HistoryArchiveRepairPlanV1 {
	readonly actionCount: number;
	readonly actions: readonly HistoryArchiveRepairActionV1[];
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly generatedAt: string;
	readonly infrastructureBlocks: readonly HistoryArchiveRepairInfrastructureBlockV1[];
	readonly limit: number;
	readonly summary: {
		readonly activeObjectChecks: number;
		readonly failedObjectChecks: number;
		readonly pendingObjectChecks: number;
		readonly verifiedObjectChecks: number;
		readonly failedCheckpointProofs: number;
	};
}
