import { mock, type MockProxy } from 'jest-mock-extended';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { ScheduleHistoryArchiveObjects } from '../ScheduleHistoryArchiveObjects.js';

describe('ScheduleHistoryArchiveObjects', () => {
	let logger: MockProxy<Logger>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let stateRepository: MockProxy<HistoryArchiveStateRepository>;

	beforeEach(() => {
		logger = mock<Logger>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		stateRepository = mock<HistoryArchiveStateRepository>();
		objectRepository.saveObjects.mockResolvedValue(0);
		objectRepository.findOldestCheckpointLedgerByArchiveUrlIdentities.mockResolvedValue(
			new Map([['https://history.example.com/archive', 500_000]])
		);
		stateRepository.findAvailable.mockResolvedValue([
			HistoryArchiveStateSnapshot.available(
				'https://history.example.com/archive',
				'https://history.example.com/archive',
				createArchiveMetadata(700_000),
				'history-scanner'
			)
		]);
	});

	it('schedules a bounded checkpoint discovery page instead of one object', async () => {
		const scheduler = new ScheduleHistoryArchiveObjects(
			objectRepository,
			stateRepository,
			logger
		);

		const result = await scheduler.execute([]);

		expect(result.isOk()).toBe(true);
		const savedObjects = objectRepository.saveObjects.mock.calls[0]?.[0] ?? [];
		const checkpointDiscoveryObjects = savedObjects.filter(
			(object) =>
				object.objectType === 'checkpoint-state' &&
				object.checkpointLedger !== null &&
				object.checkpointLedger < 500_000
		);
		expect(checkpointDiscoveryObjects).toHaveLength(256);
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
