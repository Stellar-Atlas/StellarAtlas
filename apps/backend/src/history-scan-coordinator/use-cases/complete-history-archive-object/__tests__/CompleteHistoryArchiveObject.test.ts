import { mock, type MockProxy } from 'jest-mock-extended';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { CompleteHistoryArchiveObject } from '../CompleteHistoryArchiveObject.js';

describe('CompleteHistoryArchiveObject', () => {
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let checkpointProofRepository: MockProxy<HistoryArchiveCheckpointProofRepository>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let stateRepository: MockProxy<HistoryArchiveStateRepository>;

	beforeEach(() => {
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
		objectRepository.findOldestCheckpointLedgerByArchiveUrlIdentities.mockResolvedValue(
			new Map()
		);
	});

	it('schedules only root and checkpoint-state discovery objects from verified root state', async () => {
		const archiveObject = createRootObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			archiveMetadata: createArchiveMetadata(255),
			claimAttempt: 1,
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
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
		expect(
			objectRepository.markObjectVerified.mock.invocationCallOrder[0]
		).toBeLessThan(
			objectRepository.planObjects.mock.invocationCallOrder[0] ?? 0
		);
	});

	it('schedules checkpoint sibling objects from verified checkpoint state facts', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

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
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
		expect(objectRepository.planObjects).toHaveBeenCalledTimes(1);
		const savedObjects = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toEqual([
			'ledger:0000007f',
			'transactions:0000007f',
			'results:0000007f',
			'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
			'checkpoint-state:0000003f'
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

	it('schedules a bounded older checkpoint discovery page after checkpoint verification', async () => {
		const archiveObject = createCheckpointObject(500_031);
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(500_031)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		const savedObjects = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		const olderCheckpointObjects = savedObjects.filter(
			(object) =>
				object.objectType === 'checkpoint-state' &&
				object.checkpointLedger !== null &&
				object.checkpointLedger < 500_031
		);
		expect(olderCheckpointObjects).toHaveLength(1);
	});

	it('does not schedule sibling objects when checkpoint facts do not match the claimed checkpoint', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(191)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		expect(objectRepository.markObjectVerified).toHaveBeenCalled();
	});

	it('refreshes checkpoint proof after bucket verification', async () => {
		const archiveObject = createBucketObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			bytesDownloaded: 1234,
			claimAttempt: 1,
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(checkpointProofRepository.refreshForObject).toHaveBeenCalledWith(
			archiveObject
		);
	});

	it('materializes and refreshes a legacy verified checkpoint once', async () => {
		const archiveObject = createCheckpointObject();
		archiveObject.status = 'verified';
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

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
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
		const savedObjects = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
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

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(191)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.planObjects).toHaveBeenCalled();
		const savedObjects = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toContain(
			'ledger:0000007f'
		);
		expect(savedObjects.map((object) => object.objectKey)).not.toContain(
			'ledger:000000bf'
		);
		expect(eventRecorder.recordDurably).toHaveBeenCalled();
	});

	it('rejects a stale completion before descendant fan-out', async () => {
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

		expect(result._unsafeUnwrap()).toBe(false);
		expect(objectRepository.planObjects).not.toHaveBeenCalled();
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
	});

	it('reports object completion failure when durable proof refresh fails', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		checkpointProofRepository.refreshForObject.mockRejectedValue(
			new Error('proof refresh failed')
		);

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

		expect(result._unsafeUnwrapErr()).toEqual(
			expect.objectContaining({ message: 'proof refresh failed' })
		);
		expect(eventRecorder.recordDurably).not.toHaveBeenCalled();
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

function createCheckpointObject(checkpointLedger = 127): HistoryArchiveObject {
	const checkpointHex = checkpointLedger.toString(16).padStart(8, '0');

	return new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com/archive',
		archiveUrlIdentity: 'https://history.example.com/archive',
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointHex}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `https://history.example.com/archive/history/${checkpointHex.slice(0, 2)}/${checkpointHex.slice(2, 4)}/${checkpointHex.slice(4, 6)}/history-${checkpointHex}.json`,
		remoteId: '11111111-1111-4111-8111-111111111111',
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
