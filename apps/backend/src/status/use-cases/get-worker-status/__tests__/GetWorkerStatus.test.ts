import { mock, type MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type {
	HistoryArchiveWorkerStatus,
	HistoryArchiveWorkerStatusRepository
} from '@history-scan-coordinator/domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import { GetWorkerStatus } from '../GetWorkerStatus.js';

const now = new Date('2026-07-03T12:00:00.000Z');

describe('GetWorkerStatus', () => {
	let getScannerMetrics: MockProxy<GetScannerMetrics>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let workerRepository: MockProxy<HistoryArchiveWorkerStatusRepository>;
	let useCase: GetWorkerStatus;
	let uptimeSpy: jest.SpiedFunction<typeof process.uptime>;
	let originalConfiguredWorkers: string | undefined;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(now);
		originalConfiguredWorkers = process.env.HISTORY_OBJECT_WORKER_PROCESSES;
		process.env.HISTORY_OBJECT_WORKER_PROCESSES = '24';
		uptimeSpy = jest.spyOn(process, 'uptime').mockReturnValue(10 * 60);
		getScannerMetrics = mock<GetScannerMetrics>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		workerRepository = mock<HistoryArchiveWorkerStatusRepository>();
		objectRepository.getWorkerSnapshot.mockResolvedValue(createQueueSnapshot());
		workerRepository.findRecent.mockResolvedValue([]);
		getScannerMetrics.execute.mockResolvedValue(ok(emptyScannerMetrics()));
		useCase = new GetWorkerStatus(
			getScannerMetrics,
			objectRepository,
			workerRepository
		);
	});

	afterEach(() => {
		uptimeSpy.mockRestore();
		if (originalConfiguredWorkers === undefined) {
			delete process.env.HISTORY_OBJECT_WORKER_PROCESSES;
		} else {
			process.env.HISTORY_OBJECT_WORKER_PROCESSES = originalConfiguredWorkers;
		}
		jest.useRealTimers();
	});

	it.each([
		{ fresh: 0, expected: 'unavailable' },
		{ fresh: 1, expected: 'degraded' },
		{ fresh: 23, expected: 'degraded' },
		{ fresh: 24, expected: 'ok' }
	] as const)(
		'classifies $fresh of 24 fresh registrations without backlog as $expected',
		async ({ fresh, expected }) => {
			workerRepository.findRecent.mockResolvedValue(createWorkers(fresh));

			const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

			expect(status).toMatchObject({
				freshWorkers: fresh,
				missingWorkers: 24 - fresh,
				status: expected
			});
		}
	);

	it.each([
		{ fresh: 0, expected: 'unavailable' },
		{ fresh: 1, expected: 'degraded' },
		{ fresh: 23, expected: 'degraded' },
		{ fresh: 24, expected: 'ok' }
	] as const)(
		'classifies $fresh of 24 fresh registrations with backlog as $expected',
		async ({ fresh, expected }) => {
			objectRepository.getWorkerSnapshot.mockResolvedValue(
				createQueueSnapshot({ hasPendingObjects: true })
			);
			workerRepository.findRecent.mockResolvedValue(createWorkers(fresh));

			const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

			expect(status.status).toBe(expected);
			expect(status.missingWorkers).toBe(24 - fresh);
		}
	);

	it('defines startup grace without allowing missing workers to report ok', async () => {
		uptimeSpy.mockReturnValue(30);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			freshWorkers: 0,
			missingWorkers: 24,
			startupGraceActive: true,
			startupGraceMs: 120_000,
			status: 'degraded'
		});
	});

	it('preserves queue activity during mixed old and new worker rollout', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue(
			createQueueSnapshot({
				activeObjects: 22,
				hasPendingObjects: true,
				totalScanningObjects: 22
			})
		);
		workerRepository.findRecent.mockResolvedValue([
			createWorkerStatus({ workerId: 'worker-fresh' }),
			createWorkerStatus({
				heartbeatAt: new Date('2026-07-03T11:55:00.000Z'),
				workerId: 'worker-old'
			})
		]);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			activeWorkers: 22,
			freshWorkers: 1,
			missingWorkers: 23,
			queueActiveWorkers: 22,
			registeredWorkers: 2,
			staleWorkers: 1,
			status: 'degraded',
			totalTakenJobs: 22
		});
	});

	it('uses active queue claims, but not backlog alone, as mixed-rollout runtime proof', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue(
			createQueueSnapshot({
				activeObjects: 20,
				hasPendingObjects: true,
				totalScanningObjects: 20
			})
		);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			activeWorkers: 20,
			freshWorkers: 0,
			missingWorkers: 24,
			status: 'degraded',
			totalTakenJobs: 20
		});
	});

	it('does not treat stale queue claims as current runtime proof', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue(
			createQueueSnapshot({
				hasPendingObjects: true,
				staleObjects: 20,
				totalScanningObjects: 20
			})
		);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			activeWorkers: 0,
			freshWorkers: 0,
			queueStaleWorkers: 20,
			staleWorkers: 20,
			status: 'unavailable'
		});
	});

	it('degrades a complete registry when the queue reports stale claims', async () => {
		workerRepository.findRecent.mockResolvedValue(createWorkers(24));
		objectRepository.getWorkerSnapshot.mockResolvedValue(
			createQueueSnapshot({ staleObjects: 1, totalScanningObjects: 1 })
		);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			freshWorkers: 24,
			missingWorkers: 0,
			queueStaleWorkers: 1,
			staleWorkers: 1,
			status: 'degraded'
		});
	});

	it('keeps backlog healthy when all configured workers are fresh and idle', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue(
			createQueueSnapshot({ hasPendingObjects: true })
		);
		workerRepository.findRecent.mockResolvedValue(
			createWorkers(24, { currentObject: null })
		);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(status).toMatchObject({
			activeWorkers: 0,
			freshWorkers: 24,
			idleWorkers: 24,
			status: 'ok'
		});
	});

	it('requests only fresh bounded public rows and maps process identity', async () => {
		workerRepository.findRecent.mockResolvedValue(createWorkers(24));

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(workerRepository.findRecent).toHaveBeenCalledWith({
			limit: 128,
			observedAfter: new Date('2026-07-03T11:45:00.000Z'),
			pruneBefore: new Date('2026-07-02T12:00:00.000Z')
		});
		expect(status.workers[0]).toMatchObject({
			pid: 4123,
			processGeneration: 2,
			processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5'
		});
		expect(status.telemetryMode).toBe('per-worker');
	});

	it('redacts archive source paths, queries, fragments, and credentials', async () => {
		workerRepository.findRecent.mockResolvedValue([
			createWorkerStatus({
				currentObject: {
					remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
					source:
						'https://operator:secret@archive.example/private/path?token=x#part',
					type: 'bucket'
				}
			}),
			createWorkerStatus({
				currentObject: {
					remoteId: '93a309de-a5df-457b-9412-f267ed5e7388',
					source: '/srv/private/history/file.xdr',
					type: 'ledger'
				},
				workerId: 'object-host-1-0'
			})
		]);

		const status = (await useCase.execute())._unsafeUnwrap().archiveWorkers;

		expect(
			status.workers.map((worker) => worker.currentObject?.source)
		).toEqual(['https://archive.example', 'redacted']);
	});

	it('passes through repository errors', async () => {
		const error = new Error('workers unavailable');
		objectRepository.getWorkerSnapshot.mockRejectedValue(error);

		const result = await useCase.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});

function createWorkers(
	count: number,
	options: { readonly currentObject?: 'default' | null } = {}
): HistoryArchiveWorkerStatus[] {
	return Array.from({ length: count }, (_, index) =>
		createWorkerStatus({
			...(options.currentObject === null
				? {
						bytesDownloaded: null,
						claimAttempt: null,
						currentObject: null,
						stage: 'idle' as const
					}
				: {}),
			workerId: `object-host-${index.toString()}-0`
		})
	);
}

function createWorkerStatus(
	overrides: Partial<HistoryArchiveWorkerStatus> = {}
): HistoryArchiveWorkerStatus {
	return {
		bytesDownloaded: 1024,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket'
		},
		heartbeatAt: new Date('2026-07-03T11:59:30.000Z'),
		lastOutcome: 'verified',
		lastOutcomeAt: new Date('2026-07-03T11:58:00.000Z'),
		pid: 4123,
		processGeneration: 2,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: new Date('2026-07-03T11:00:00.000Z'),
		sequence: 9,
		stage: 'downloading_bucket',
		workerId: 'object-host-0-0',
		...overrides
	};
}

function createQueueSnapshot(
	overrides: Partial<{
		readonly activeObjects: number;
		readonly hasPendingObjects: boolean;
		readonly staleObjects: number;
		readonly totalScanningObjects: number;
	}> = {}
) {
	return {
		activeObjects: 0,
		hasPendingObjects: false,
		staleObjects: 0,
		totalScanningObjects: 0,
		...overrides
	};
}

function emptyScannerMetrics() {
	return {
		activeScanners: 0,
		averageCompletionTimeMs: 0,
		averageSuccessRate: 0,
		blacklistedScanners: 0,
		degradedScanners: 0,
		generatedAt: now.toISOString(),
		heartbeatFreshnessMs: 300_000,
		offlineScanners: 0,
		pendingScanners: 0,
		totalJobsCompleted: 0,
		totalJobsFailed: 0,
		totalScanners: 0
	};
}
