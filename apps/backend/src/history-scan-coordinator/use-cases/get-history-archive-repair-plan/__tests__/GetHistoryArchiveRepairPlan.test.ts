import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveCheckpointProof } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { GetHistoryArchiveRepairPlan } from '../GetHistoryArchiveRepairPlan.js';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';

const archiveUrl = 'https://history.example.com';
const archiveUrlIdentity = 'https://history.example.com';
const bucketHash =
	'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

describe('GetHistoryArchiveRepairPlan', () => {
	it('separates archive repair actions from scanner infrastructure blocks', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);
		objectRepository.getSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createBucketFailure(),
			createWorkerFailure()
		]);
		objectRepository.findBucketObjectsByHash.mockResolvedValue([
			createVerifiedBucketCopy()
		]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([
			createCheckpointProof()
		]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'replace-bucket-file',
					knownGoodSources: [
						expect.objectContaining({
							archiveUrl: 'https://other-history.example.com'
						})
					],
					reason: 'bucket-hash-mismatch'
				}),
				expect.objectContaining({
					kind: 'repair-checkpoint-proof',
					reason: 'transaction-hash-mismatch'
				})
			])
		);
		expect(result.value.infrastructureBlocks).toEqual([
			expect.objectContaining({
				evidenceClass: 'worker-infrastructure',
				failureClass: 'worker'
			})
		]);
		expect(objectRepository.findBucketObjectsByHash).toHaveBeenCalledWith(
			bucketHash
		);
	});

	it('does not turn incomplete checkpoint proofs into repair actions', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);
		objectRepository.getSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([]);
		objectRepository.findBucketObjectsByHash.mockResolvedValue([]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([
			createIncompleteCheckpointProof()
		]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.actions).toEqual([]);
	});

	it('preserves a checkpoint ledger mismatch in the repair plan', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);
		objectRepository.getSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([
			Object.assign(createCheckpointProof(), {
				failureKind: 'checkpoint-ledger-mismatch'
			})
		]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result._unsafeUnwrap().actions).toEqual([
			expect.objectContaining({
				reason: 'checkpoint-ledger-mismatch',
				summary: 'Checkpoint state file does not declare checkpoint 63355999.'
			})
		]);
	});

	it('preserves a checkpoint-state object ledger mismatch in the repair plan', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);
		objectRepository.getSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createCheckpointLedgerMismatch()
		]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result._unsafeUnwrap().actions).toEqual([
			expect.objectContaining({
				evidence: [
					expect.objectContaining({ observedCheckpointLedger: 63355935 })
				],
				kind: 'replace-archive-file',
				reason: 'checkpoint-ledger-mismatch',
				summary: 'Checkpoint state file does not declare checkpoint 63355999.'
			})
		]);
	});

	it('does not turn an aborted bucket download into a replacement action', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);
		objectRepository.getSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createAbortedBucketFailure()
		]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.actions).toEqual([]);
		expect(objectRepository.findBucketObjectsByHash).not.toHaveBeenCalled();
	});

	it('rejects invalid archive URLs before hitting repositories', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			mock<ExceptionLogger>()
		);

		const result = await useCase.execute({ url: 'not-a-url' });

		expect(result.isErr()).toBe(true);
		expect(objectRepository.getSummary).not.toHaveBeenCalled();
	});
});

function createBucketFailure(): HistoryArchiveObject {
	const object = createObject('bucket', `bucket:${bucketHash}`, 'failed');
	object.bucketHash = bucketHash;
	object.checkpointLedger = 63355999;
	object.errorType = 'HASH_MISMATCH';
	object.errorMessage = 'Bucket hash mismatch';
	return object;
}

function createWorkerFailure(): HistoryArchiveObject {
	const object = createObject('ledger', 'ledger:03c1dcbf', 'failed');
	object.checkpointLedger = 63355999;
	object.errorType = 'WORKER_EACCES';
	object.errorMessage = 'Worker could not create cache directory';
	object.nextAttemptAt = new Date('2026-07-07T18:05:00.000Z');
	return object;
}

function createAbortedBucketFailure(): HistoryArchiveObject {
	const object = createObject('bucket', `bucket:${bucketHash}`, 'failed');
	object.bucketHash = bucketHash;
	object.errorType = 'bucket_verification_failed';
	object.errorMessage = 'aborted';
	object.httpStatus = 200;
	return object;
}

function createCheckpointLedgerMismatch(): HistoryArchiveObject {
	const object = createObject(
		'checkpoint-state',
		'checkpoint-state:03c1dcbf',
		'failed'
	);
	object.checkpointLedger = 63355999;
	object.errorType = 'checkpoint_state_ledger_mismatch';
	object.errorMessage = 'Checkpoint state declares ledger 63355935';
	object.verificationFacts = {
		checkpointHistoryArchiveStateFact: {
			bucketListHash: bucketHash,
			checkpointLedger: 63355935,
			observedAt: '2026-07-07T18:00:00.000Z',
			stellarHistoryUrl: object.objectUrl
		}
	};
	return object;
}

function createVerifiedBucketCopy(): HistoryArchiveObject {
	const object = createObject('bucket', `bucket:${bucketHash}`, 'verified');
	object.archiveUrl = 'https://other-history.example.com';
	object.archiveUrlIdentity = 'https://other-history.example.com';
	object.objectUrl =
		'https://other-history.example.com/bucket/4e/ae/73/bucket-' +
		bucketHash +
		'.xdr.gz';
	object.bucketHash = bucketHash;
	object.verifiedAt = new Date('2026-07-07T18:00:00.000Z');
	return object;
}

function createObject(
	objectType: HistoryArchiveObject['objectType'],
	objectKey: string,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity,
		objectKey,
		objectOrder: 1,
		objectType,
		objectUrl: `${archiveUrl}/${objectKey}`,
		remoteId: crypto.randomUUID(),
		status
	});
	(object as HistoryArchiveObject & { updatedAt: Date }).updatedAt = new Date(
		'2026-07-07T18:00:00.000Z'
	);
	return object;
}

function createCheckpointProof(): HistoryArchiveCheckpointProof {
	return Object.assign(new HistoryArchiveCheckpointProof(), {
		archiveUrl,
		archiveUrlIdentity,
		bucketsVerified: true,
		checkpointBucketListHash: 'checkpoint-bucket-list-hash',
		checkpointBucketListMatches: true,
		checkpointLedger: 63355999,
		evaluatedAt: new Date('2026-07-07T18:00:00.000Z'),
		expectedBucketCount: 4,
		failedBucketCount: 0,
		failureKind: 'transaction-hash-mismatch',
		ledgerBucketListHash: 'ledger-bucket-list-hash',
		ledgerFactCount: 64,
		missingBucketCount: 0,
		previousLedgersMatch: true,
		proofFactsComplete: true,
		proofVersion: 1,
		requiredObjectsComplete: true,
		resultFactCount: 1,
		resultsMatch: true,
		status: 'mismatch',
		transactionFactCount: 1,
		transactionsMatch: false,
		verifiedBucketCount: 4
	} satisfies Partial<HistoryArchiveCheckpointProof>);
}

function createIncompleteCheckpointProof(): HistoryArchiveCheckpointProof {
	return Object.assign(createCheckpointProof(), {
		bucketsVerified: false,
		failureKind: 'bucket-missing',
		missingBucketCount: 4,
		status: 'not-evaluable',
		verifiedBucketCount: 0
	} satisfies Partial<HistoryArchiveCheckpointProof>);
}

function createSummary(): HistoryArchiveObjectSummaryV1 {
	return {
		activeObjects: 0,
		archiveUrl,
		archiveUrlIdentity,
		buckets: {
			activeBucketObjects: 0,
			failedBucketObjects: 1,
			pendingBucketObjects: 0,
			totalBucketObjects: 2,
			uniqueBucketHashes: 1,
			verifiedBucketObjects: 1
		},
		checkpoints: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 1,
			categoryConsistencyFailedCheckpoints: 1,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 0,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 1,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 1,
			failedArchiveCheckpoints: 1,
			latestCheckpointLedger: 63355999,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 1,
			oldestCheckpointLedger: 63355999,
			partialArchiveCheckpoints: 0,
			totalArchiveCheckpoints: 1
		},
		failedObjects: 2,
		generatedAt: '2026-07-07T18:00:00.000Z',
		hostThrottles: [],
		objectTypes: [],
		pendingObjects: 0,
		scope: 'archive',
		sources: [],
		totalObjects: 3,
		verifiedObjects: 1
	};
}
