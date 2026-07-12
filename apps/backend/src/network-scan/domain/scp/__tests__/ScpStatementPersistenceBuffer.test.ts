import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationRepository } from '../ScpStatementObservationRepository.js';
import type { ScpStatementProjectionSink } from '../ScpStatementPersistenceBuffer.js';
import { ScpStatementPersistenceBuffer } from '../ScpStatementPersistenceBuffer.js';
import {
	ScpStatementPersistenceCapacityError,
	ScpStatementPersistenceTimeoutError
} from '../ScpStatementPersistenceError.js';

describe('ScpStatementPersistenceBuffer', () => {
	afterEach(() => jest.useRealTimers());

	it('projects only the canonical winner returned by the deferred Postgres write', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const projector = mock<ScpStatementProjectionSink>();
		const logger = mock<Logger>();
		const attempted = createObservation(1, 'peer-a');
		const winner = createObservation(1, 'peer-z');
		const postgres = deferred<CrawlerScpStatementObservation[]>();
		repository.saveMany.mockReturnValue(postgres.promise);
		const buffer = createBuffer(repository, projector, logger);

		const committed = buffer.add(attempted);
		await flushMicrotasks();

		expect(repository.saveMany).toHaveBeenCalledWith(
			[attempted],
			'scp_live_collector'
		);
		expect(projector.enqueue).not.toHaveBeenCalled();

		postgres.resolve([winner]);
		await committed;
		expect(projector.enqueue).toHaveBeenCalledWith([winner]);
		expect(projector.enqueue).not.toHaveBeenCalledWith([attempted]);
		expect(repository.saveMany.mock.invocationCallOrder[0]).toBeLessThan(
			projector.enqueue.mock.invocationCallOrder[0]!
		);
	});

	it('does not project rejected older or equal provenance from overlapping collectors', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const logger = mock<Logger>();
		const firstProjector = mock<ScpStatementProjectionSink>();
		const secondProjector = mock<ScpStatementProjectionSink>();
		const older = createObservation(1, 'peer-z');
		const newer = {
			...older,
			observedAt: new Date(older.observedAt.getTime() + 1_000),
			observedFromPeer: 'peer-a'
		};
		const lowerEqual = { ...newer, observedFromPeer: 'peer-a' };
		const winner = { ...newer, observedFromPeer: 'peer-z' };
		const firstSave = deferred<CrawlerScpStatementObservation[]>();
		const secondSave = deferred<CrawlerScpStatementObservation[]>();
		repository.saveMany
			.mockReturnValueOnce(firstSave.promise)
			.mockReturnValueOnce(secondSave.promise);
		const first = createBuffer(repository, firstProjector, logger);
		const second = createBuffer(repository, secondProjector, logger);

		const firstCommitted = first.add(older);
		const secondCommitted = second.add(lowerEqual);
		await flushMicrotasks();
		secondSave.resolve([winner]);
		await secondCommitted;
		firstSave.resolve([winner]);
		await firstCommitted;

		expect(firstProjector.enqueue).toHaveBeenCalledWith([winner]);
		expect(secondProjector.enqueue).toHaveBeenCalledWith([winner]);
		expect(firstProjector.enqueue).not.toHaveBeenCalledWith([older]);
		expect(secondProjector.enqueue).not.toHaveBeenCalledWith([lowerEqual]);
	});

	it('times out a never-settling canonical write and releases flush without projection', async () => {
		jest.useFakeTimers();
		const repository = mock<ScpStatementObservationRepository>();
		const projector = mock<ScpStatementProjectionSink>();
		const logger = mock<Logger>();
		repository.saveMany.mockReturnValue(new Promise(() => {}));
		const buffer = new ScpStatementPersistenceBuffer(
			repository,
			projector,
			logger,
			{ batchSize: 1, flushDelayMs: 60_000, saveTimeoutMs: 100 }
		);
		const committed = buffer.add(createObservation(1));
		const flushed = buffer.flush();

		jest.advanceTimersByTime(100);
		await flushMicrotasks();

		await expect(committed).rejects.toBeInstanceOf(
			ScpStatementPersistenceTimeoutError
		);
		await expect(flushed).rejects.toBeInstanceOf(
			ScpStatementPersistenceTimeoutError
		);
		expect(projector.enqueue).not.toHaveBeenCalled();
		await expect(buffer.flush()).rejects.toBeInstanceOf(
			ScpStatementPersistenceTimeoutError
		);
	});

	it('bounds queued observations while a canonical write is blocked', async () => {
		jest.useFakeTimers();
		const repository = mock<ScpStatementObservationRepository>();
		repository.saveMany.mockReturnValue(new Promise(() => {}));
		const buffer = new ScpStatementPersistenceBuffer(
			repository,
			mock<ScpStatementProjectionSink>(),
			mock<Logger>(),
			{
				batchSize: 1,
				flushDelayMs: 60_000,
				maxBufferedObservations: 2,
				saveTimeoutMs: 100
			}
		);
		const first = buffer.add(createObservation(1));
		const second = buffer.add(createObservation(2));
		const firstRejected = expect(first).rejects.toBeInstanceOf(
			ScpStatementPersistenceTimeoutError
		);
		const secondRejected = expect(second).rejects.toBeInstanceOf(
			ScpStatementPersistenceTimeoutError
		);

		await expect(buffer.add(createObservation(3))).rejects.toBeInstanceOf(
			ScpStatementPersistenceCapacityError
		);
		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		await firstRejected;
		await secondRejected;
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
	});

	it('persists 5,001 observations in bounded streaming batches', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const projector = mock<ScpStatementProjectionSink>();
		const logger = mock<Logger>();
		repository.saveMany.mockImplementation(async (observations) => [
			...observations
		]);
		const batchSize = 250;
		const buffer = new ScpStatementPersistenceBuffer(
			repository,
			projector,
			logger,
			{ batchSize, flushDelayMs: 60_000 }
		);
		const observations = Array.from({ length: 5_001 }, (_, index) =>
			createObservation(index)
		);
		const committed = Promise.all(
			observations.map((observation) => buffer.add(observation))
		);

		await buffer.flush();
		await committed;

		const persisted = repository.saveMany.mock.calls.flatMap(
			([batch]) => batch
		);
		expect(persisted).toHaveLength(observations.length);
		expect(
			new Set(persisted.map(({ statementHash }) => statementHash)).size
		).toBe(observations.length);
		expect(
			repository.saveMany.mock.calls.every(
				([batch]) => batch.length <= batchSize
			)
		).toBe(true);
	});
});

function createBuffer(
	repository: ScpStatementObservationRepository,
	projector: ScpStatementProjectionSink,
	logger: Logger
): ScpStatementPersistenceBuffer {
	return new ScpStatementPersistenceBuffer(repository, projector, logger, {
		batchSize: 1,
		flushDelayMs: 60_000
	});
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

function createObservation(
	index: number,
	observedFromPeer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date(1_783_600_000_000 + index),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer,
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: `signature-${index}`,
		slotIndex: String(index),
		statementHash: `statement-${index}`,
		statementType: 'externalize',
		statementXdr: `xdr-${index}`,
		values: []
	};
}
