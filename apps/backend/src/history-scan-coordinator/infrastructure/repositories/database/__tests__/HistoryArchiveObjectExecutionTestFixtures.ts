import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { DataSource } from 'typeorm';

export function createRoot(index: number): HistoryArchiveObject {
	return createObject(index, {
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		status: 'verified'
	});
}

export function createCheckpoint(index: number, checkpointLedger: number) {
	return createObject(index, {
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointLedger.toString(16).padStart(8, '0')}`,
		objectOrder: 10,
		objectType: 'checkpoint-state'
	});
}

export function createBucket(
	index: number,
	bucketHash: string
): HistoryArchiveObject {
	const object = createObject(index, {
		checkpointLedger: 1_000_063,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 60,
		objectType: 'bucket'
	});
	object.bucketHash = bucketHash;
	return object;
}

export function createBucketMissingProof(
	archiveUrl: string,
	checkpointLedger: number
): HistoryArchiveCheckpointProof {
	const proof = new HistoryArchiveCheckpointProof();
	proof.archiveUrl = archiveUrl;
	proof.archiveUrlIdentity = archiveUrl;
	proof.checkpointLedger = checkpointLedger;
	proof.status = 'not-evaluable';
	proof.proofVersion = 5;
	proof.requiredObjectsComplete = true;
	proof.proofFactsComplete = true;
	proof.checkpointBucketListMatches = true;
	proof.transactionsMatch = true;
	proof.resultsMatch = true;
	proof.previousLedgersMatch = true;
	proof.bucketsVerified = false;
	proof.ledgerFactCount = 64;
	proof.transactionFactCount = 64;
	proof.resultFactCount = 64;
	proof.expectedBucketCount = 1;
	proof.verifiedBucketCount = 0;
	proof.failedBucketCount = 0;
	proof.missingBucketCount = 1;
	proof.checkpointBucketListHash = null;
	proof.ledgerBucketListHash = null;
	proof.checkpointStateObjectRemoteId = null;
	proof.ledgerObjectRemoteId = null;
	proof.transactionsObjectRemoteId = null;
	proof.resultsObjectRemoteId = null;
	proof.scpObjectRemoteId = null;
	proof.failureKind = 'bucket-missing';
	proof.details = null;
	proof.evaluatedAt = new Date();
	return proof;
}

export function createCanonicalCheckpointFacts(
	bucketHash: string,
	stellarHistoryUrl: string,
	checkpointLedger: number
) {
	return {
		checkpointHistoryArchiveState: {
			observedAt: '2026-01-01T00:00:00.000Z',
			stellarHistory: {
				currentBuckets: [{ curr: bucketHash, snap: '0'.repeat(64) }],
				hotArchiveBuckets: []
			},
			stellarHistoryUrl
		},
		checkpointHistoryArchiveStateFact: {
			bucketListHash: 'ef'.repeat(32),
			checkpointLedger,
			observedAt: '2026-01-01T00:00:00.000Z',
			stellarHistoryUrl
		},
		content: {
			algorithm: 'sha256',
			digest: 'cd'.repeat(32),
			representation: 'canonical-json'
		}
	} satisfies HistoryArchiveObject['verificationFacts'];
}

export function createCanonicalObject(
	index: number,
	objectType: HistoryArchiveObject['objectType'],
	objectKey: string,
	checkpointLedger: number | null,
	status: HistoryArchiveObject['status'] = 'pending',
	objectOrder = 10
): HistoryArchiveObject {
	const archiveUrl = `https://canonical-${index}.example/history`;
	const item = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		dependencyReady: objectType === 'history-archive-state',
		executionDisposition: 'deferred',
		hostIdentity: `canonical-${index}.example`,
		objectKey,
		objectOrder,
		objectType,
		objectUrl: `${archiveUrl}/${objectKey}`,
		status
	});
	item.executionReason = 'legacy-planning-intent';
	return item;
}

export async function readCanonicalRows(
	dataSource: DataSource,
	status?: string
): Promise<readonly { readonly checkpointLedger: number }[]> {
	return dataSource.query<{ readonly checkpointLedger: number }[]>(
		`select "checkpointLedger"
		 from "history_archive_object_queue"
		 where "executionReason" = 'canonical-frontier-reserve'
			and ($1::text is null or status = $1)
		 order by "archiveUrlIdentity"`,
		[status ?? null]
	);
}

export function createObject(
	index: number,
	props: Pick<
		ConstructorParameters<typeof HistoryArchiveObject>[0] & object,
		'checkpointLedger' | 'objectKey' | 'objectOrder' | 'objectType' | 'status'
	>
): HistoryArchiveObject {
	const archiveUrl = `https://archive-${index}.example/history`;
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: props.checkpointLedger,
		executionDisposition: 'deferred',
		objectKey: props.objectKey,
		objectOrder: props.objectOrder,
		objectType: props.objectType,
		objectUrl: `${archiveUrl}/${props.objectKey}`,
		status: props.status ?? 'pending'
	});
	object.dependencyReady = null;
	object.executionReason = 'legacy-planning-intent';
	return object;
}
