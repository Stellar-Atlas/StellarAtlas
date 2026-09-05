import { mock, type MockProxy } from 'jest-mock-extended';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { historyArchiveCheckpointFanoutBatchSize } from '../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { CompleteHistoryArchiveObject } from '../CompleteHistoryArchiveObject.js';

describe('CompleteHistoryArchiveObject', () => {
	const configuredProofRefreshBatchSize =
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE;
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let checkpointProofRepository: MockProxy<HistoryArchiveCheckpointProofRepository>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let stateRepository: MockProxy<HistoryArchiveStateRepository>;

	beforeEach(() => {
		process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE = '4';
		eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		checkpointProofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		stateRepository = mock<HistoryArchiveStateRepository>();
		objectRepository.markObjectVerified.mockImplementation(
			async (remoteId, progress) => {
				const object = await objectRepository.findByRemoteId(remoteId);
				if (object === null) return false;
				object.status = 'verified';
				object.attempts = progress?.claimAttempt ?? object.attempts;
				object.verificationFacts =
					progress?.verificationFacts ?? object.verificationFacts;
				object.completionArchiveMetadata = progress?.archiveMetadata ?? null;
				object.transitionEffectsRequiredAt = new Date();
				return true;
			}
		);
		objectRepository.markObjectsVerified.mockImplementation(async (updates) => {
			const verified = new Set<string>();
			for (const update of updates) {
				if (
					await objectRepository.markObjectVerified(
						update.remoteId,
						update.progress
					)
				) {
					verified.add(update.remoteId);
				}
			}
			return verified;
		});
		objectRepository.findByRemoteIds.mockImplementation(async (remoteIds) => {
			const objects = await Promise.all(
				remoteIds.map(
					async (remoteId) => await objectRepository.findByRemoteId(remoteId)
				)
			);
			return objects.filter(
				(object): object is HistoryArchiveObject => object !== null
			);
		});
		objectRepository.markCheckpointDescendantsPlanned.mockImplementation(
			async (remoteId) => {
				const object = await objectRepository.findByRemoteId(remoteId);
				if (object === null) return false;
				object.descendantsPlannedAt = new Date();
				return true;
			}
		);
		objectRepository.findOldestCheckpointLedgerByArchiveUrlIdentities.mockResolvedValue(
			new Map()
		);
	});

	afterEach(() => {
		if (configuredProofRefreshBatchSize === undefined) {
			delete process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE;
		} else {
			process.env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_BATCH_SIZE =
				configuredProofRefreshBatchSize;
		}
	});

	it('acknowledges completion only after durable transition effects finish', async () => {
		const archiveObject = createBucketObject();
		archiveObject.attempts = 1;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.withTransitionEffectsLock.mockImplementation(
			async (_remoteId, _claimAttempt, work) => await work()
		);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.executeAndReconcile(archiveObject.remoteId, {
			claimAttempt: 1
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.withTransitionEffectsLock).toHaveBeenCalledWith(
			archiveObject.remoteId,
			1,
			expect.any(Function)
		);
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
		expect(eventRecorder.recordDurably).toHaveBeenCalledWith(archiveObject, {
			claimAttempt: 1,
			eventType: 'verified'
		});
		expect(
			objectRepository.markTransitionEffectsCompleted
		).toHaveBeenCalledWith(archiveObject.remoteId, 1, 'verified');
		expect(objectRepository.promotePlannedObjects).not.toHaveBeenCalled();
	});

	it('reconciles ordinary verified transitions with set-based writes', async () => {
		const bucket = createBucketObject();
		bucket.status = 'verified';
		bucket.attempts = 1;
		const ledger = new HistoryArchiveObject({
			archiveUrl: bucket.archiveUrl,
			archiveUrlIdentity: bucket.archiveUrlIdentity,
			objectKey: 'ledger:0000007f',
			objectOrder: 20,
			objectType: 'ledger',
			objectUrl: `${bucket.archiveUrl}/ledger-0000007f.xdr.gz`,
			remoteId: '22222222-2222-4222-8222-222222222222',
			status: 'verified'
		});
		ledger.attempts = 2;
		objectRepository.markTransitionEffectsCompletedBatch.mockResolvedValue(
			new Set([bucket.remoteId, ledger.remoteId])
		);
		objectRepository.drainCheckpointProofRefreshQueue.mockResolvedValue({
			claimed: 0,
			completed: 0,
			failed: 0
		});
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		await useCase.reconcileVerifiedTransitionBatch([bucket, ledger]);
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(eventRecorder.recordDurablyBatch).toHaveBeenCalledTimes(1);
		expect(eventRecorder.recordDurablyBatch).toHaveBeenCalledWith([
			{
				object: bucket,
				options: { claimAttempt: 1, eventType: 'verified' }
			},
			{
				object: ledger,
				options: { claimAttempt: 2, eventType: 'verified' }
			}
		]);
		expect(
			objectRepository.markTransitionEffectsCompletedBatch
		).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.markTransitionEffectsCompleted
		).not.toHaveBeenCalled();
		expect(
			objectRepository.enqueueCheckpointProofRefreshes
		).toHaveBeenCalledWith([bucket.remoteId, ledger.remoteId]);
	});

	it('reconciles checkpoint transitions with set-based writes and fanout', async () => {
		const first = createCheckpointObject(
			127,
			'11111111-1111-4111-8111-111111111111'
		);
		const second = createCheckpointObject(
			191,
			'22222222-2222-4222-8222-222222222222'
		);
		for (const object of [first, second]) {
			object.status = 'verified';
			object.attempts = 1;
			object.verificationFacts = {
				checkpointHistoryArchiveState: createArchiveMetadata(
					object.checkpointLedger!
				)
			};
		}
		objectRepository.markTransitionEffectsCompletedBatch.mockResolvedValue(
			new Set([first.remoteId, second.remoteId])
		);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		await useCase.reconcileVerifiedTransitionBatch([first, second]);

		expect(eventRecorder.recordDurablyBatch).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.markTransitionEffectsCompletedBatch
		).toHaveBeenCalledWith([
			{ claimAttempt: 1, remoteId: first.remoteId, status: 'verified' },
			{ claimAttempt: 1, remoteId: second.remoteId, status: 'verified' }
		]);
		expect(
			objectRepository.markTransitionEffectsCompleted
		).not.toHaveBeenCalled();
		expect(
			objectRepository.materializeCheckpointDependencyBatch
		).toHaveBeenCalledWith([first.remoteId, second.remoteId]);
		expect(objectRepository.activateObjects).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.markCheckpointDescendantsPlannedBatch
		).toHaveBeenCalledWith([first.remoteId, second.remoteId]);
	});

	it('schedules only root and checkpoint-state discovery objects from verified root state', async () => {
		const archiveObject = createRootObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			archiveMetadata: createArchiveMetadata(255),
			claimAttempt: 1,
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		await useCase.reconcilePersisted(archiveObject);
		expect(stateRepository.saveAvailable).toHaveBeenCalledWith(
			archiveObject.archiveUrl,
			createArchiveMetadata(255),
			'history-scanner'
		);
		const savedObjects = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.length).toBeGreaterThan(1);
		expect(new Set(savedObjects.map((object) => object.objectType))).toEqual(
			new Set(['history-archive-state', 'checkpoint-state'])
		);
		expect(savedObjects.map((object) => object.objectType)).not.toContain(
			'ledger'
		);
		expect(savedObjects.map((object) => object.objectType)).not.toContain(
			'transactions'
		);
		expect(savedObjects.map((object) => object.objectType)).not.toContain(
			'results'
		);
		expect(savedObjects.map((object) => object.objectType)).not.toContain(
			'bucket'
		);
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
		expect(objectRepository.promotePlannedObjects).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.markObjectVerified.mock.invocationCallOrder[0]
		).toBeLessThan(
			objectRepository.planObjects.mock.invocationCallOrder[0] ?? 0
		);
	});

	it('schedules checkpoint sibling objects from verified checkpoint state facts', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(127)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
		expect(objectRepository.activateObjects).toHaveBeenCalledTimes(1);
		expect(objectRepository.promotePlannedObjects).not.toHaveBeenCalled();
		const savedObjects =
			objectRepository.activateObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toEqual([
			'ledger:0000007f',
			'transactions:0000007f',
			'results:0000007f',
			'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655'
		]);
		expect(objectRepository.markObjectVerified).toHaveBeenCalledWith(
			archiveObject.remoteId,
			expect.objectContaining({
				claimAttempt: 1,
				verificationFacts: {
					checkpointHistoryArchiveState: createArchiveMetadata(127)
				},
				workerStage: 'verified'
			})
		);
	});

	it('does not expand older checkpoints during checkpoint fanout', async () => {
		const archiveObject = createCheckpointObject(500_031);
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(500_031)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await useCase.reconcilePersisted(archiveObject);
		const savedObjects =
			objectRepository.activateObjects.mock.calls[0]?.[0] ?? [];
		const olderCheckpointObjects = savedObjects.filter(
			(object) =>
				object.objectType === 'checkpoint-state' &&
				object.checkpointLedger !== null &&
				object.checkpointLedger < 500_031
		);
		expect(olderCheckpointObjects).toHaveLength(0);
	});

	it('does not schedule sibling objects when checkpoint facts do not match the claimed checkpoint', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(191)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await useCase.reconcilePersisted(archiveObject);
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		expect(objectRepository.markObjectVerified).toHaveBeenCalled();
	});

	it('enqueues proof work without draining it in the completion request', async () => {
		const archiveObject = createBucketObject();
		objectRepository.enqueueCheckpointProofRefreshes.mockResolvedValue(1);
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			bytesDownloaded: 1234,
			claimAttempt: 1,
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
		await useCase.reconcilePersisted(archiveObject);
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
		await new Promise<void>((resolve) => {
			setImmediate(resolve);
		});
		expect(
			objectRepository.enqueueCheckpointProofRefreshes
		).toHaveBeenCalledWith([archiveObject.remoteId]);
		expect(
			objectRepository.drainCheckpointProofRefreshQueue
		).not.toHaveBeenCalled();
	});

	it('lets non-maintenance API workers enqueue without competing for the proof root lock', async () => {
		const configuredWriter = process.env.API_HISTORY_MAINTENANCE_WRITER;
		process.env.API_HISTORY_MAINTENANCE_WRITER = 'false';
		try {
			const bucket = createBucketObject();
			bucket.status = 'verified';
			bucket.attempts = 1;
			objectRepository.markTransitionEffectsCompletedBatch.mockResolvedValue(
				new Set([bucket.remoteId])
			);
			const useCase = new CompleteHistoryArchiveObject(
				objectRepository,
				stateRepository,
				eventRecorder,
				checkpointProofRepository
			);

			await useCase.reconcileVerifiedTransitionBatch([bucket]);
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(
				objectRepository.enqueueCheckpointProofRefreshes
			).toHaveBeenCalledWith([bucket.remoteId]);
			expect(
				objectRepository.drainCheckpointProofRefreshQueue
			).not.toHaveBeenCalled();
		} finally {
			if (configuredWriter === undefined) {
				delete process.env.API_HISTORY_MAINTENANCE_WRITER;
			} else {
				process.env.API_HISTORY_MAINTENANCE_WRITER = configuredWriter;
			}
		}
	});

	it('repairs stale fanout markers without plan-table writes', async () => {
		const first = createCheckpointObject(
			127,
			'11111111-1111-4111-8111-111111111111'
		);
		const second = createCheckpointObject(
			191,
			'22222222-2222-4222-8222-222222222222'
		);
		for (const object of [first, second]) {
			object.status = 'verified';
			object.descendantsPlannedAt = new Date('2026-08-21T00:00:00.000Z');
			object.verificationFacts = {
				checkpointHistoryArchiveState: createArchiveMetadata(
					object.checkpointLedger!
				)
			};
		}
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		await expect(
			useCase.reconcileCheckpointFanouts([first, second])
		).resolves.toBe(2);
		expect(
			objectRepository.materializeCheckpointDependencyBatch
		).toHaveBeenCalledWith([first.remoteId, second.remoteId]);
		expect(objectRepository.activateObjects).toHaveBeenCalledTimes(1);
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		expect(
			objectRepository.markCheckpointDescendantsPlannedBatch
		).toHaveBeenCalledWith([first.remoteId, second.remoteId]);
		expect(
			objectRepository.materializeCheckpointDependencyBatch.mock
				.invocationCallOrder[0]
		).toBeLessThan(
			objectRepository.activateObjects.mock.invocationCallOrder[0]!
		);
	});
	it('bounds each fanout write while draining every pending checkpoint', async () => {
		const checkpoints = Array.from(
			{ length: historyArchiveCheckpointFanoutBatchSize + 1 },
			(_, index) => {
				const checkpoint = createCheckpointObject(
					127 + index * 64,
					`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
				);
				checkpoint.status = 'verified';
				checkpoint.verificationFacts = {
					checkpointHistoryArchiveState: createArchiveMetadata(
						checkpoint.checkpointLedger!
					)
				};
				return checkpoint;
			}
		);
		objectRepository.markCheckpointDescendantsPlanned.mockResolvedValue(true);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		await expect(useCase.reconcileCheckpointFanouts(checkpoints)).resolves.toBe(
			checkpoints.length
		);
		expect(objectRepository.activateObjects).toHaveBeenCalledTimes(2);
		expect(
			objectRepository.materializeCheckpointDependencyBatch
		).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.materializeCheckpointDependencies
		).toHaveBeenCalledTimes(1);
	});

	it('materializes and refreshes a legacy verified checkpoint once', async () => {
		const archiveObject = createCheckpointObject();
		archiveObject.status = 'verified';
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		await useCase.reconcileCheckpointDependencies(archiveObject);
		archiveObject.dependenciesMaterializedAt = new Date();
		await useCase.reconcileCheckpointDependencies(archiveObject);

		expect(
			objectRepository.materializeCheckpointDependencies
		).toHaveBeenCalledTimes(1);
		expect(
			objectRepository.materializeCheckpointDependencies
		).toHaveBeenCalledWith(archiveObject.remoteId);
		expect(checkpointProofRepository.refreshForObject).toHaveBeenCalledTimes(2);
		expect(checkpointProofRepository.refreshForObject).toHaveBeenCalledWith(
			archiveObject
		);
	});

	it('uses persisted root state passphrase before scheduling early scp objects', async () => {
		const archiveObject = createCheckpointObject(1_214_015);
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		stateRepository.findByUrl.mockResolvedValue(
			HistoryArchiveStateSnapshot.available(
				archiveObject.archiveUrl,
				archiveObject.archiveUrlIdentity,
				createArchiveMetadata(1_214_079, {
					networkPassphrase: 'Test SDF Network ; September 2015'
				}),
				'history-scanner'
			)
		);

		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(1_214_015),
				checkpointHistoryArchiveStateFact: {
					bucketListHash: 'bucket-list-hash',
					checkpointLedger: 1_214_015,
					observedAt: '2026-07-06T15:00:00.000Z',
					stellarHistoryUrl: archiveObject.objectUrl
				}
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await useCase.reconcilePersisted(archiveObject);
		const savedObjects =
			objectRepository.activateObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toContain(
			'scp:0012863f'
		);
		expect(objectRepository.markObjectVerified).toHaveBeenCalledWith(
			archiveObject.remoteId,
			expect.objectContaining({
				verificationFacts: expect.objectContaining({
					checkpointHistoryArchiveStateFact: expect.objectContaining({
						networkPassphrase: 'Test SDF Network ; September 2015'
					})
				})
			})
		);
	});

	it('reconciles missing descendants for an exact verified-attempt replay', async () => {
		const archiveObject = createCheckpointObject();
		archiveObject.status = 'verified';
		archiveObject.attempts = 1;
		archiveObject.verificationFacts = {
			checkpointHistoryArchiveState: createArchiveMetadata(127)
		};
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectVerified.mockResolvedValue(false);

		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(191)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await useCase.reconcilePersisted(archiveObject);
		expect(objectRepository.activateObjects).toHaveBeenCalled();
		const savedObjects =
			objectRepository.activateObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toContain(
			'ledger:0000007f'
		);
		expect(savedObjects.map((object) => object.objectKey)).not.toContain(
			'ledger:000000bf'
		);
		expect(eventRecorder.recordDurably).toHaveBeenCalled();
	});

	it('acknowledges a superseded completion without descendant fan-out', async () => {
		const archiveObject = createCheckpointObject();
		archiveObject.attempts = 2;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectVerified.mockResolvedValue(false);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(127)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
	});

	it('leaves durable transition work pending when proof refresh fails', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		checkpointProofRepository.refreshForObject.mockRejectedValue(
			new Error('proof refresh failed')
		);

		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		);

		const result = await useCase.execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(127)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		await expect(
			useCase.reconcilePersisted(archiveObject)
		).resolves.toBeUndefined();
		expect(eventRecorder.recordDurably).toHaveBeenCalled();
	});
});

function createRootObject(): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com/archive',
		archiveUrlIdentity: 'https://history.example.com/archive',
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl:
			'https://history.example.com/archive/.well-known/stellar-history.json',
		remoteId: '11111111-1111-4111-8111-111111111111',
		status: 'scanning'
	});
}

function createCheckpointObject(
	checkpointLedger = 127,
	remoteId = '11111111-1111-4111-8111-111111111111'
): HistoryArchiveObject {
	const checkpointHex = checkpointLedger.toString(16).padStart(8, '0');

	return new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com/archive',
		archiveUrlIdentity: 'https://history.example.com/archive',
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointHex}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `https://history.example.com/archive/history/${checkpointHex.slice(0, 2)}/${checkpointHex.slice(2, 4)}/${checkpointHex.slice(4, 6)}/history-${checkpointHex}.json`,
		remoteId,
		status: 'scanning'
	});
}

function createBucketObject(): HistoryArchiveObject {
	const bucketHash =
		'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

	return new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com/archive',
		archiveUrlIdentity: 'https://history.example.com/archive',
		bucketHash,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `https://history.example.com/archive/bucket/4e/ae/73/bucket-${bucketHash}.xdr.gz`,
		remoteId: '11111111-1111-4111-8111-111111111111',
		status: 'scanning'
	});
}

function createArchiveMetadata(
	currentLedger: number,
	options: { readonly networkPassphrase?: string | null } = {}
): ArchiveMetadataDTO {
	return {
		observedAt: '2026-07-06T15:00:00.000Z',
		stellarHistory: {
			currentBuckets: [
				{
					curr: '4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
					next: { state: 0 },
					snap: '0000000000000000000000000000000000000000000000000000000000000000'
				}
			],
			currentLedger,
			networkPassphrase: options.networkPassphrase,
			server: 'stellar-core',
			version: 1
		},
		stellarHistoryUrl:
			'https://history.example.com/archive/history/00/00/00/history-0000007f.json'
	};
}
