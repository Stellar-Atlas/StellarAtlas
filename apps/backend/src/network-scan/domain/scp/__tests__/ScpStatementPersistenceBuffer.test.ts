import { mock } from 'jest-mock-extended';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationRepository } from '../ScpStatementObservationRepository.js';
import { ScpStatementPersistenceBuffer } from '../ScpStatementPersistenceBuffer.js';
import {
	ScpStatementPersistenceCapacityError,
	ScpStatementPersistenceClosedError,
	ScpStatementPersistenceFatalError,
	ScpStatementPersistenceTimeoutError
} from '../ScpStatementPersistenceError.js';

describe('ScpStatementPersistenceBuffer', () => {
	afterEach(() => jest.useRealTimers());

	it('waits for the durable Postgres write without projecting returned winners', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const attempted = createObservation(1, 'peer-a');
		const winner = createObservation(1, 'peer-z');
		const postgres = deferred<CrawlerScpStatementObservation[]>();
		repository.saveMany.mockReturnValue(postgres.promise);
		const buffer = createBuffer(repository);

		const committed = buffer.add(attempted);
		await flushMicrotasks();

		expect(repository.saveMany).toHaveBeenCalledWith(
			[attempted],
			'scp_live_collector'
		);

		postgres.resolve([winner]);
		await committed;
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		expect(repository.findProjectionEventPage).not.toHaveBeenCalled();
	});

	it('never overlaps an unsettled write and retries the same batch after it fails', async () => {
		jest.useFakeTimers();
		const repository = mock<ScpStatementObservationRepository>();
		const observation = createObservation(1);
		const newerObservation = createObservation(2);
		const firstWrite = deferred<CrawlerScpStatementObservation[]>();
		const retryWrite = deferred<CrawlerScpStatementObservation[]>();
		repository.saveMany
			.mockReturnValueOnce(firstWrite.promise)
			.mockReturnValueOnce(retryWrite.promise)
			.mockResolvedValueOnce([newerObservation]);
		const buffer = new ScpStatementPersistenceBuffer(repository, {
			batchSize: 1,
			flushDelayMs: 60_000,
			retryInitialDelayMs: 100,
			retryJitterRatio: 0,
			retryMaxDelayMs: 1_000
		});
		const committed = buffer.add(observation);
		const newerCommitted = buffer.add(newerObservation);
		const flushed = buffer.flush();
		await flushMicrotasks();

		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(60_000);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(1);

		firstWrite.reject(
			Object.assign(new Error('query failed'), {
				driverError: createDatabaseError('57014')
			})
		);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(99);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(1);
		await flushMicrotasks();

		expect(repository.saveMany).toHaveBeenCalledTimes(2);
		expect(repository.saveMany.mock.calls[1]?.[0]).toEqual([observation]);
		retryWrite.resolve([observation]);
		await Promise.all([committed, newerCommitted, flushed]);
		expect(repository.saveMany).toHaveBeenCalledTimes(3);
		expect(repository.saveMany.mock.calls[2]?.[0]).toEqual([newerObservation]);
	});

	it('caps exponential retry backoff and resets it after a committed batch', async () => {
		jest.useFakeTimers();
		const repository = mock<ScpStatementObservationRepository>();
		let call = 0;
		repository.saveMany.mockImplementation(async (observations) => {
			call += 1;
			if (call === 1 || call === 5) {
				throw new ScpStatementPersistenceTimeoutError(100);
			}
			if (call === 2) throw createDatabaseError('55P03');
			if (call === 3) throw createDatabaseError('57014');
			return [...observations];
		});
		const buffer = new ScpStatementPersistenceBuffer(repository, {
			batchSize: 1,
			flushDelayMs: 60_000,
			retryInitialDelayMs: 100,
			retryJitterRatio: 0,
			retryMaxDelayMs: 250
		});

		const first = buffer.add(createObservation(1));
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(100);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(2);
		jest.advanceTimersByTime(200);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(3);
		jest.advanceTimersByTime(250);
		await first;
		expect(repository.saveMany).toHaveBeenCalledTimes(4);

		const second = buffer.add(createObservation(2));
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(5);
		jest.advanceTimersByTime(99);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(5);
		jest.advanceTimersByTime(1);
		await second;
		expect(repository.saveMany).toHaveBeenCalledTimes(6);
	});

	it('fails active and queued observations on a non-retryable error', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const failure = new Error('invalid SCP statement schema');
		repository.saveMany.mockRejectedValue(failure);
		const buffer = createBuffer(repository);
		const first = buffer.add(createObservation(1));
		const second = buffer.add(createObservation(2));
		const flushed = buffer.flush();
		const firstRejected = expect(first).rejects.toBeInstanceOf(
			ScpStatementPersistenceFatalError
		);
		const secondRejected = expect(second).rejects.toBeInstanceOf(
			ScpStatementPersistenceFatalError
		);
		const flushRejected = expect(flushed).rejects.toMatchObject({
			cause: failure
		});

		await firstRejected;
		await secondRejected;
		await flushRejected;
		await expect(buffer.flush()).rejects.toMatchObject({ cause: failure });
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
	});

	it('closes to new observations while draining a retained retry', async () => {
		jest.useFakeTimers();
		const repository = mock<ScpStatementObservationRepository>();
		repository.saveMany
			.mockRejectedValueOnce(createDatabaseError('55P03'))
			.mockImplementationOnce(async (observations) => [...observations]);
		const buffer = new ScpStatementPersistenceBuffer(repository, {
			batchSize: 1,
			flushDelayMs: 60_000,
			retryInitialDelayMs: 100,
			retryJitterRatio: 0,
			retryMaxDelayMs: 1_000
		});
		const committed = buffer.add(createObservation(1));
		const drained = buffer.closeAndFlush();

		await expect(buffer.add(createObservation(2))).rejects.toBeInstanceOf(
			ScpStatementPersistenceClosedError
		);
		await flushMicrotasks();
		expect(repository.saveMany).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(100);
		await committed;
		await drained;
		expect(repository.saveMany).toHaveBeenCalledTimes(2);
	});

	it('bounds queued observations while a canonical write is blocked', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		const blocked = deferred<CrawlerScpStatementObservation[]>();
		repository.saveMany
			.mockReturnValueOnce(blocked.promise)
			.mockImplementation(async (observations) => [...observations]);
		const buffer = new ScpStatementPersistenceBuffer(repository, {
			batchSize: 1,
			flushDelayMs: 60_000,
			maxBufferedObservations: 2
		});
		const first = buffer.add(createObservation(1));
		const second = buffer.add(createObservation(2));

		await expect(buffer.add(createObservation(3))).rejects.toBeInstanceOf(
			ScpStatementPersistenceCapacityError
		);
		blocked.resolve([createObservation(1)]);
		await first;
		await second;
		expect(repository.saveMany).toHaveBeenCalledTimes(2);
	});

	it('persists 5,001 observations in bounded streaming batches', async () => {
		const repository = mock<ScpStatementObservationRepository>();
		repository.saveMany.mockImplementation(async (observations) => [
			...observations
		]);
		const batchSize = 250;
		const buffer = new ScpStatementPersistenceBuffer(repository, {
			batchSize,
			flushDelayMs: 60_000
		});
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
	repository: ScpStatementObservationRepository
): ScpStatementPersistenceBuffer {
	return new ScpStatementPersistenceBuffer(repository, {
		batchSize: 1,
		flushDelayMs: 60_000
	});
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, reject, resolve };
}

function createDatabaseError(code: string): Error {
	return Object.assign(new Error(`database error ${code}`), { code });
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
