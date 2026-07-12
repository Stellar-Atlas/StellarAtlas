import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';

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
