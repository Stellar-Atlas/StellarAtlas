import { mock, type MockProxy } from 'jest-mock-extended';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { ScheduleHistoryArchiveObjects } from '../ScheduleHistoryArchiveObjects.js';
import type { ReconcileHistoryArchiveObjectTransitions } from '../../reconcile-history-archive-object-transitions/ReconcileHistoryArchiveObjectTransitions.js';

describe('ScheduleHistoryArchiveObjects', () => {
	let logger: MockProxy<Logger>;
	let transitionReconciler: MockProxy<ReconcileHistoryArchiveObjectTransitions>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let stateRepository: MockProxy<HistoryArchiveStateRepository>;

	beforeEach(() => {
		logger = mock<Logger>();
		transitionReconciler = mock<ReconcileHistoryArchiveObjectTransitions>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		stateRepository = mock<HistoryArchiveStateRepository>();
		objectRepository.planObjects.mockResolvedValue(0);
		objectRepository.promotePlannedObjects.mockResolvedValue({
			availableSlots: 48,
			outstandingObjects: 0,
			promotedObjects: 2,
			recentCompletions: 0,
			watermark: 48
		});
		objectRepository.reconcileDependencyReadiness.mockResolvedValue(0);
		objectRepository.reconcileExecutionDisposition.mockResolvedValue({
			admittedObjects: 0,
			availableSlots: 48,
			cursorAdvances: 0,
			outstandingObjects: 0,
			preservedObjects: 0,
			recentCompletions: 0,
			watermark: 48
		});
		stateRepository.findAvailable.mockResolvedValue([
			HistoryArchiveStateSnapshot.available(
				'https://history.example.com/archive',
				'https://history.example.com/archive',
				createArchiveMetadata(700_000),
				'history-scanner'
			)
		]);
	});

	it('plans only the current frontier instead of historical pages', async () => {
		const scheduler = new ScheduleHistoryArchiveObjects(
			objectRepository,
			stateRepository,
			transitionReconciler,
			logger
		);

		const result = await scheduler.execute([]);

		expect(result.isOk()).toBe(true);
		const plannedObjects =
			objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		expect(plannedObjects).toHaveLength(2);
		expect(
			plannedObjects.filter(
				(object) => object.objectType === 'checkpoint-state'
			)
		).toHaveLength(1);
		expect(
			plannedObjects.find(
				(object) => object.objectType === 'history-archive-state'
			)?.status
		).toBe('verified');
	});

	it('bounds a production-size 79-root scheduling pass', async () => {
		const states = Array.from({ length: 79 }, (_, index) => {
			const archiveUrl = `https://history-${index}.example/archive`;
			return HistoryArchiveStateSnapshot.available(
				archiveUrl,
				archiveUrl,
				{
					...createArchiveMetadata(700_000),
					stellarHistoryUrl: `${archiveUrl}/.well-known/stellar-history.json`
				},
				'history-scanner'
			);
		});
		stateRepository.findAvailable.mockResolvedValue(states);
		const scheduler = new ScheduleHistoryArchiveObjects(
			objectRepository,
			stateRepository,
			transitionReconciler,
			logger
		);

		await scheduler.execute(states.map((state) => state.archiveUrl));

		const plans = objectRepository.planObjects.mock.calls[0]?.[0] ?? [];
		expect(plans).toHaveLength(79 * 3);
		expect(plans.length).toBeLessThan(19_687 / 80);
		expect(objectRepository.promotePlannedObjects).toHaveBeenCalledTimes(1);
	});

	it('replays durable terminal effects before producing more work', async () => {
		const scheduler = new ScheduleHistoryArchiveObjects(
			objectRepository,
			stateRepository,
			transitionReconciler,
			logger
		);

		await scheduler.execute([]);

		expect(transitionReconciler.executeIfDue).toHaveBeenCalledTimes(1);
		expect(
			transitionReconciler.executeIfDue.mock.invocationCallOrder[0]
		).toBeLessThan(
			objectRepository.planObjects.mock.invocationCallOrder[0] ?? 0
		);
	});
});

function createArchiveMetadata(currentLedger: number): ArchiveMetadataDTO {
	return {
		observedAt: '2026-07-06T15:45:00.000Z',
		stellarHistory: {
			currentBuckets: [],
			currentLedger,
			networkPassphrase: 'Public Global Stellar Network ; September 2015',
			server: 'stellar-core',
			version: 1
		},
		stellarHistoryUrl:
			'https://history.example.com/archive/.well-known/stellar-history.json'
	};
}
