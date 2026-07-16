import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveCheckpointProof } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectRepository,
	HistoryArchiveRepairPlanSummary,
	HistoryArchiveVerifiedBucketSource
} from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveRepairArtifactAvailabilityV1 } from '../../get-history-archive-repair-artifact/HistoryArchiveRepairArtifactContract.js';
import { ResolveHistoryArchiveRepairArtifacts } from '../../get-history-archive-repair-artifact/ResolveHistoryArchiveRepairArtifacts.js';
import { GetHistoryArchiveRepairPlan } from '../GetHistoryArchiveRepairPlan.js';

const archiveUrl = 'https://history.example.com';
const archiveUrlIdentity = 'https://history.example.com';
const bucketHash =
	'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';
const unrelatedBucketHash = 'a'.repeat(64);

describe('GetHistoryArchiveRepairPlan', () => {
	it('separates archive repair actions from scanner infrastructure blocks', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const repairArtifacts = createArtifactResolver();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			repairArtifacts,
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createBucketFailure(),
			createWorkerFailure()
		]);
		objectRepository.findVerifiedBucketSourcesByHashes.mockResolvedValue([
			createVerifiedBucketCopy(),
			{
				...createVerifiedBucketCopy(),
				archiveUrl: 'https://unrelated-history.example.com',
				archiveUrlIdentity: 'https://unrelated-history.example.com',
				bucketHash: unrelatedBucketHash
			}
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
							archiveUrl: 'https://other-history.example.com',
							objectUrl: expect.stringMatching(
								/^https:\/\/other-history\.example\.com\//
							)
						})
					],
					reason: 'bucket-hash-mismatch',
					repairArtifact: expect.objectContaining({
						reason: 'local-payload-missing',
						status: 'unavailable'
					}),
					severity: 'blocked'
				}),
				expect.objectContaining({
					kind: 'repair-checkpoint-proof',
					reason: 'transaction-hash-mismatch',
					severity: 'blocked'
				})
			])
		);
		expect(result.value.infrastructureBlocks).toEqual([
			expect.objectContaining({
				evidenceClass: 'worker-infrastructure',
				failureClass: 'worker'
			})
		]);
		expect(
			objectRepository.findVerifiedBucketSourcesByHashes
		).toHaveBeenCalledWith([bucketHash], 5);
		expect(repairArtifacts.execute).toHaveBeenCalledWith([bucketHash]);
		const bucketAction = result.value.actions.find(
			(action) => action.kind === 'replace-bucket-file'
		);
		expect(JSON.stringify(bucketAction?.repairArtifact)).not.toContain(
			'https://other-history.example.com'
		);
	});

	it('offers a local download URL only for a proven retained bucket', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			createArtifactResolver(createAvailableArtifact()),
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createBucketFailure()
		]);
		objectRepository.findVerifiedBucketSourcesByHashes.mockResolvedValue([
			createVerifiedBucketCopy()
		]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result._unsafeUnwrap().actions[0]).toEqual(
			expect.objectContaining({
				repairArtifact: expect.objectContaining({
					downloadUrl: `/v1/archive-scans/repair-artifacts/buckets/${bucketHash}`,
					objectIdentity: `bucket:${bucketHash}`,
					status: 'available'
				}),
				severity: 'error'
			})
		);
	});

	it('does not turn incomplete checkpoint proofs into repair actions', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			createArtifactResolver(),
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([]);
		objectRepository.findVerifiedBucketSourcesByHashes.mockResolvedValue([]);
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
			createArtifactResolver(),
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
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
				severity: 'blocked',
				summary:
					'Checkpoint state file does not declare checkpoint 63355999. No proof-gated replacement set is available yet.'
			})
		]);
	});

	it('preserves a checkpoint-state object ledger mismatch in the repair plan', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			createArtifactResolver(),
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
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
				severity: 'blocked',
				summary:
					'Checkpoint history file evidence is confirmed, but no proof-gated replacement artifact is available yet.'
			})
		]);
	});

	it('does not turn an aborted bucket download into a replacement action', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			createArtifactResolver(),
			mock<ExceptionLogger>()
		);
		objectRepository.getRepairPlanSummary.mockResolvedValue(createSummary());
		objectRepository.findActionableByArchiveUrl.mockResolvedValue([
			createAbortedBucketFailure()
		]);
		proofRepository.findActionableByArchiveUrlIdentity.mockResolvedValue([]);

		const result = await useCase.execute({ limit: 25, url: archiveUrl });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.actions).toEqual([]);
		expect(
			objectRepository.findVerifiedBucketSourcesByHashes
		).not.toHaveBeenCalled();
	});

	it('rejects invalid archive URLs before hitting repositories', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new GetHistoryArchiveRepairPlan(
			objectRepository,
			proofRepository,
			createArtifactResolver(),
			mock<ExceptionLogger>()
		);

		const result = await useCase.execute({ url: 'not-a-url' });

		expect(result.isErr()).toBe(true);
		expect(objectRepository.getRepairPlanSummary).not.toHaveBeenCalled();
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

function createVerifiedBucketCopy(): HistoryArchiveVerifiedBucketSource {
	return {
		archiveUrl: 'https://other-history.example.com',
		archiveUrlIdentity: 'https://other-history.example.com',
		bucketHash,
		objectUrl:
			'https://other-history.example.com/bucket/4e/ae/73/bucket-' +
			bucketHash +
			'.xdr.gz',
		verifiedAt: new Date('2026-07-07T18:00:00.000Z')
	};
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

function createSummary(): HistoryArchiveRepairPlanSummary {
	return {
		activeObjects: 0,
		failedCheckpointProofs: 1,
		failedObjects: 2,
		hostThrottles: [],
		pendingObjects: 0,
		verifiedObjects: 1
	};
}

function createArtifactResolver(
	artifact: HistoryArchiveRepairArtifactAvailabilityV1 = createUnavailableArtifact()
) {
	const resolver = mock<ResolveHistoryArchiveRepairArtifacts>();
	resolver.execute.mockResolvedValue(new Map([[bucketHash, artifact]]));
	return resolver;
}

function createUnavailableArtifact(): HistoryArchiveRepairArtifactAvailabilityV1 {
	return {
		artifactType: 'bucket',
		contentHash: {
			algorithm: 'sha256',
			digest: bucketHash,
			representation: 'uncompressed-xdr'
		},
		objectIdentity: `bucket:${bucketHash}`,
		reason: 'local-payload-missing',
		retry: { afterSeconds: 60, retryable: true },
		status: 'unavailable'
	};
}

function createAvailableArtifact(): HistoryArchiveRepairArtifactAvailabilityV1 {
	return {
		artifactType: 'bucket',
		byteLength: 128,
		contentHash: {
			algorithm: 'sha256',
			digest: bucketHash,
			representation: 'uncompressed-xdr'
		},
		downloadUrl: `/v1/archive-scans/repair-artifacts/buckets/${bucketHash}`,
		mediaType: 'application/gzip',
		objectIdentity: `bucket:${bucketHash}`,
		provenAt: '2026-07-07T18:00:00.000Z',
		status: 'available'
	};
}
