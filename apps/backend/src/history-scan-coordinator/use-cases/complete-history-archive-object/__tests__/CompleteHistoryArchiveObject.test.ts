import { mock, type MockProxy } from 'jest-mock-extended';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { CompleteHistoryArchiveObject } from '../CompleteHistoryArchiveObject.js';

describe('CompleteHistoryArchiveObject', () => {
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let stateRepository: MockProxy<HistoryArchiveStateRepository>;

	beforeEach(() => {
		eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		stateRepository = mock<HistoryArchiveStateRepository>();
		objectRepository.markObjectVerified.mockResolvedValue(true);
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
			eventRecorder
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
		const savedObjects = objectRepository.saveObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.length).toBeGreaterThan(1);
		expect(
			new Set(savedObjects.map((object) => object.objectType))
		).toEqual(new Set(['history-archive-state', 'checkpoint-state']));
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
	});

	it('schedules checkpoint sibling objects from verified checkpoint state facts', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(127)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(stateRepository.saveAvailable).not.toHaveBeenCalled();
		expect(objectRepository.saveObjects).toHaveBeenCalledTimes(1);
		const savedObjects = objectRepository.saveObjects.mock.calls[0]?.[0] ?? [];
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

	it('does not schedule sibling objects when checkpoint facts do not match the claimed checkpoint', async () => {
		const archiveObject = createCheckpointObject();
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

		const result = await new CompleteHistoryArchiveObject(
			objectRepository,
			stateRepository,
			eventRecorder
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(191)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.saveObjects).toHaveBeenCalledWith([]);
		expect(objectRepository.markObjectVerified).toHaveBeenCalled();
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
			eventRecorder
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			verificationFacts: {
				checkpointHistoryArchiveState: createArchiveMetadata(1_214_015)
			},
			workerStage: 'verified'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		const savedObjects = objectRepository.saveObjects.mock.calls[0]?.[0] ?? [];
		expect(savedObjects.map((object) => object.objectKey)).toContain(
			'scp:0012863f'
		);
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
