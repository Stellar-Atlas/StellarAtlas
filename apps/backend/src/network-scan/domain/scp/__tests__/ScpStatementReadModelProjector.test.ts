import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from '../ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from '../ScpStatementObservationRepository.js';
import { ScpStatementReadModelProjector } from '../ScpStatementReadModelProjector.js';

describe('ScpStatementReadModelProjector', () => {
	afterEach(() => jest.useRealTimers());

	it('times out, cools down, retains newest data, and caps orphan concurrency', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		const logger = mock<Logger>();
		liveStore.saveMany.mockImplementation(() => new Promise(() => {}));
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			logger,
			{ cooldownMs: 200, maxOutstandingRequests: 2, timeoutMs: 100 }
		);
		const first = createObservation(1);
		const pending = createObservation(2);
		const newest = createObservation(3);
		const saturated = createObservation(4);

		projector.enqueue([first]);
		await flushMicrotasks();
		projector.enqueue([pending]);
		projector.enqueue([newest]);
		expect(liveStore.saveMany).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		expect(logger.warn).toHaveBeenCalledWith(
			'Live SCP read-model projection timed out',
			expect.objectContaining({
				cooldownMs: 200,
				outstandingRequests: 1,
				timeoutMs: 100
			})
		);

		jest.advanceTimersByTime(199);
		await flushMicrotasks();
		expect(liveStore.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(1);
		await flushMicrotasks();
		expect(liveStore.saveMany).toHaveBeenCalledTimes(2);
		expect(liveStore.saveMany.mock.calls[1]?.[0]).toEqual(
			expect.arrayContaining([pending, newest])
		);

		projector.enqueue([saturated]);
		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		jest.advanceTimersByTime(200);
		await flushMicrotasks();
		expect(liveStore.saveMany).toHaveBeenCalledTimes(2);
		projector.shutdown();
	});

	it.each([
		['below', 4_999],
		['above', 5_001]
	] as const)(
		'backfills every canonical observation %s the 5,000-row pending limit',
		async (_label, count) => {
			const canonical = Array.from({ length: count }, (_, index) =>
				createObservation(index + 1)
			);
			const liveStore = mock<ScpStatementLiveStore>();
			const repository = createRepositoryMock();
			const logger = mock<Logger>();
			const accepted: CrawlerScpStatementObservation[][] = [];
			liveStore.saveMany
				.mockResolvedValueOnce({ reason: 'index-setup', status: 'deferred' })
				.mockImplementation(async (observations) => {
					accepted.push([...observations]);
					return { status: 'accepted' };
				});
			repository.findProjectionPage.mockImplementation(
				async ({ afterId, limit }) => {
					const observations = canonical.slice(afterId, afterId + limit);
					const nextAfterId =
						afterId + observations.length < canonical.length
							? afterId + observations.length
							: null;
					return { nextAfterId, observations };
				}
			);
			const projector = new ScpStatementReadModelProjector(
				liveStore,
				repository,
				logger,
				{ cooldownMs: 0, timeoutMs: 1_000 }
			);

			projector.enqueue(canonical);
			const drained = await projector.drain(5_000);

			expect(drained).toBe(true);
			const projectedHashes = new Set(
				accepted.flat().map(({ statementHash }) => statementHash)
			);
			expect(projectedHashes.size).toBe(count);
			for (const observation of canonical) {
				expect(projectedHashes.has(observation.statementHash)).toBe(true);
			}
			expect(
				repository.findProjectionPage.mock.calls.every(
					([filter]) => filter.limit <= 1_000
				)
			).toBe(true);
		}
	);

	it('backfills recent canonical PostgreSQL rows when a collector starts', async () => {
		const observation = createObservation(1);
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		liveStore.saveMany.mockResolvedValue({ status: 'accepted' });
		repository.findProjectionPage.mockResolvedValue({
			nextAfterId: null,
			observations: [observation]
		});
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			mock<Logger>()
		);

		projector.start();

		await expect(projector.drain(1_000)).resolves.toBe(true);
		expect(liveStore.saveMany).toHaveBeenCalledWith([observation]);
	});

	it('times out pool-starved backfill reads and caps detached acquisitions', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		const logger = mock<Logger>();
		repository.findProjectionPage.mockReturnValue(new Promise(() => {}));
		liveStore.saveMany.mockResolvedValue({ status: 'accepted' });
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			logger,
			{
				backfillTimeoutMs: 100,
				cooldownMs: 50,
				maxOutstandingRequests: 2
			}
		);

		projector.start();
		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		expect(logger.warn).toHaveBeenCalledWith(
			'PostgreSQL projection backfill timed out',
			expect.objectContaining({ outstandingRequests: 1 })
		);

		const observation = createObservation(1);
		projector.enqueue([observation]);
		jest.advanceTimersByTime(50);
		await flushMicrotasks();
		expect(liveStore.saveMany).toHaveBeenCalledWith([observation]);

		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		jest.advanceTimersByTime(50);
		await flushMicrotasks();
		expect(repository.findProjectionPage).toHaveBeenCalledTimes(2);
		projector.shutdown();
	});

	it('reconciles a final failed Meili task and backfills without another write', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const observation = createObservation(1);
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		liveStore.saveMany
			.mockResolvedValueOnce({ status: 'accepted', taskPending: true })
			.mockResolvedValue({ status: 'accepted' });
		liveStore.reconcilePendingTask.mockResolvedValue({
			reason: 'document-task-failed',
			retryAfterMs: 0,
			status: 'failed'
		});
		repository.findProjectionPage.mockResolvedValue({
			nextAfterId: null,
			observations: [observation]
		});
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			mock<Logger>(),
			{ cooldownMs: 0, taskReconciliationIntervalMs: 50 }
		);

		projector.enqueue([observation]);
		await flushMicrotasks();
		jest.advanceTimersByTime(50);
		await flushMicrotasks();

		expect(liveStore.reconcilePendingTask).toHaveBeenCalledTimes(1);
		expect(repository.findProjectionPage).toHaveBeenCalledTimes(1);
		expect(liveStore.saveMany).toHaveBeenCalledTimes(2);
		await expect(projector.drain(1_000)).resolves.toBe(true);
	});

	it('does not drain while an accepted Meili task is still outstanding', async () => {
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		const reconciliation =
			deferred<
				Awaited<ReturnType<ScpStatementLiveStore['reconcilePendingTask']>>
			>();
		liveStore.saveMany.mockResolvedValue({
			status: 'accepted',
			taskPending: true
		});
		liveStore.reconcilePendingTask.mockReturnValue(reconciliation.promise);
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			mock<Logger>()
		);

		projector.enqueue([createObservation(1)]);
		await flushMicrotasks();
		let drained = false;
		const drain = projector.drain(1_000).then((result) => {
			drained = result;
			return result;
		});
		await flushMicrotasks();
		expect(drained).toBe(false);

		reconciliation.resolve({ status: 'settled' });
		await expect(drain).resolves.toBe(true);
	});

	it('continuously tails canonical winners committed by another process', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const winner = createObservation(42);
		const liveStore = mock<ScpStatementLiveStore>();
		const repository = createRepositoryMock();
		repository.findProjectionPage.mockResolvedValue({
			nextAfterId: null,
			observations: []
		});
		repository.findProjectionEventPage
			.mockResolvedValueOnce({
				hasMore: false,
				nextAfterId: 0,
				observations: []
			})
			.mockResolvedValueOnce({
				hasMore: false,
				nextAfterId: 1,
				observations: [winner]
			});
		liveStore.saveMany.mockResolvedValue({ status: 'accepted' });
		const projector = new ScpStatementReadModelProjector(
			liveStore,
			repository,
			mock<Logger>(),
			{ tailPollIntervalMs: 100 }
		);

		projector.start();
		await flushMicrotasks();
		expect(liveStore.saveMany).not.toHaveBeenCalled();

		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		expect(liveStore.saveMany).toHaveBeenCalledWith([winner]);
		await expect(projector.drain(1_000)).resolves.toBe(true);
	});
});

function createRepositoryMock() {
	const repository = mock<ScpStatementObservationRepository>();
	repository.findProjectionEventPage.mockResolvedValue({
		hasMore: false,
		nextAfterId: 0,
		observations: []
	});
	return repository;
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
	for (let iteration = 0; iteration < 12; iteration += 1) {
		await Promise.resolve();
	}
}

function createObservation(index: number): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date(1_783_600_000_000 + index),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: `signature-${index}`,
		slotIndex: String(index),
		statementHash: `statement-${index}`,
		statementType: 'externalize',
		statementXdr: `xdr-${index}`,
		values: []
	};
}
