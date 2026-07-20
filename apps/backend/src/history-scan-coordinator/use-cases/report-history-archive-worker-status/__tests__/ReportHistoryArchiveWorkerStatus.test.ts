import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveWorkerStatusRepository } from '../../../domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import { ReportHistoryArchiveWorkerStatus } from '../ReportHistoryArchiveWorkerStatus.js';

describe('ReportHistoryArchiveWorkerStatus', () => {
	it('stamps and persists a worker heartbeat', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const repository = mock<HistoryArchiveWorkerStatusRepository>();
		const useCase = new ReportHistoryArchiveWorkerStatus(
			repository,
			mock<ExceptionLogger>()
		);
		const report = createReport();

		const result = await useCase.execute(report);

		expect(result.isOk()).toBe(true);
		expect(repository.report).toHaveBeenCalledWith(
			report,
			new Date('2026-07-10T12:00:00.000Z')
		);
		jest.useRealTimers();
	});
});

function createReport() {
	return {
		bytesDownloaded: null,
		bytesTotal: null,
		claimAttempt: null,
		currentObject: null,
		lastOutcome: 'none' as const,
		lastOutcomeAt: null,
		pid: 4123,
		processGeneration: 0,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T11:00:00.000Z',
		sequence: 1,
		slotIndex: 0,
		stage: 'idle' as const,
		workerId: 'object-host-0-0'
	};
}
