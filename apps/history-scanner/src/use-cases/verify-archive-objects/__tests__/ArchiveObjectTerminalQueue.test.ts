import { mock } from 'jest-mock-extended';
import { err, ok, type Result } from 'neverthrow';
import type { Logger } from 'logger';
import type { ScanCoordinatorService } from '../../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveObjectJobDelivery } from '../HistoryArchiveObjectJobDelivery.js';
import { ArchiveObjectTerminalQueue } from '../ArchiveObjectTerminalQueue.js';
import { ArchiveObjectWorkerTelemetry } from '../ArchiveObjectWorkerTelemetry.js';
import { archiveObjectTerminalDrainTimeoutMs } from '../ArchiveObjectShutdown.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { resolve, promise };
}
function delivery(id: string) {
	return mock<HistoryArchiveObjectJobDelivery>({
		executionId: `execution-${id}`,
		source: 'broker',
		job: {
			remoteId: id,
			claimAttempt: 1,
			objectType: 'ledger',
			objectKey: id,
			archiveUrl: 'https://archive/',
			objectUrl: `https://archive/${id}`,
			bucketHash: null,
			checkpointLedger: 63
		}
	});
}
function fixture(capacity = 2) {
	const coordinator = mock<ScanCoordinatorService>();
	coordinator.completeHistoryArchiveObjects.mockImplementation(async (items) =>
		ok(items.map(() => ok(undefined)))
	);
	coordinator.completeHistoryArchiveObject.mockResolvedValue(ok(undefined));
	coordinator.failHistoryArchiveObject.mockResolvedValue(ok(undefined));
	const telemetry = mock<ArchiveObjectWorkerTelemetry>();
	const onError = jest.fn();
	const queue = new ArchiveObjectTerminalQueue(
		capacity,
		coordinator,
		telemetry,
		mock<Logger>(),
		onError,
		async () => undefined
	);
	return { queue, coordinator, telemetry, onError };
}
async function turns() {
	for (let index = 0; index < 12; index++) await Promise.resolve();
}

describe('bounded terminal persistence', () => {
	afterEach(() => jest.useRealTimers());
	it('failure writes are not held behind a slow successful batch or accumulated success', async () => {
		const { queue, coordinator } = fixture(3);
		const slow = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValueOnce(slow.promise);
		await queue.enqueue(delivery('a'), ok({}));
		await queue.enqueue(delivery('b'), ok({}));
		const failure = delivery('failure');
		await queue.enqueue(
			failure,
			err({
				errorMessage: 'missing',
				errorType: 'missing',
				failureChannel: 'archive_error'
			})
		);
		await turns();
		expect(coordinator.failHistoryArchiveObject).toHaveBeenCalledTimes(1);
		expect(failure.acknowledge).toHaveBeenCalledTimes(1);
		slow.resolve(ok([ok(undefined)]));
		await queue.drain();
	});
	it('batches same-turn successes and never ACKs before durable batch response', async () => {
		const { queue, coordinator, telemetry } = fixture();
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValue(write.promise);
		const a = delivery('a'),
			b = delivery('b');
		await Promise.all([queue.enqueue(a, ok({})), queue.enqueue(b, ok({}))]);
		expect(coordinator.completeHistoryArchiveObjects).toHaveBeenCalledTimes(1);
		expect(coordinator.completeHistoryArchiveObjects.mock.calls[0][0]).toEqual([
			{
				remoteId: 'a',
				completion: {
					claimAttempt: 1,
					executionId: 'execution-a',
					scheduler: 'broker'
				}
			},
			{
				remoteId: 'b',
				completion: {
					claimAttempt: 1,
					executionId: 'execution-b',
					scheduler: 'broker'
				}
			}
		]);
		expect(telemetry.detachSlot).toHaveBeenCalledTimes(2);
		expect(a.acknowledge).not.toHaveBeenCalled();
		write.resolve(ok([ok(undefined), ok(undefined)]));
		await queue.drain();
		expect(a.acknowledge).toHaveBeenCalledTimes(1);
		expect(b.acknowledge).toHaveBeenCalledTimes(1);
		expect(queue.metrics).toMatchObject({
			pending: 0,
			capacity: 2,
			completed: 2,
			retried: 0
		});
	});
	it('bounds queued plus in-flight occupancy and admits when persistence frees a place', async () => {
		const { queue, coordinator } = fixture(1);
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValueOnce(
			write.promise
		);
		await queue.enqueue(delivery('a'), ok({}));
		let admitted = false;
		const next = queue.enqueue(delivery('b'), ok({})).then(() => {
			admitted = true;
		});
		await turns();
		expect(admitted).toBe(false);
		expect(queue.metrics.pending).toBe(1);
		write.resolve(ok([ok(undefined)]));
		await next;
		await queue.drain();
		expect(admitted).toBe(true);
	});
	it('accumulates arrivals behind one in-flight batch, then writes all available results together', async () => {
		const { queue, coordinator } = fixture(3);
		const slow = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValueOnce(slow.promise);
		const a = delivery('a'),
			b = delivery('b'),
			c = delivery('c');
		await queue.enqueue(a, ok({}));
		await queue.enqueue(b, ok({}));
		await queue.enqueue(c, ok({}));
		await turns();
		expect(coordinator.completeHistoryArchiveObjects).toHaveBeenCalledTimes(1);
		expect(b.acknowledge).not.toHaveBeenCalled();
		expect(a.acknowledge).not.toHaveBeenCalled();
		slow.resolve(ok([ok(undefined)]));
		await queue.drain();
		expect(coordinator.completeHistoryArchiveObjects).toHaveBeenCalledTimes(2);
		expect(queue.metrics).toMatchObject({
			batchRequests: 2,
			batchItems: 3,
			maxBatchSize: 2
		});
		expect(
			coordinator.completeHistoryArchiveObjects.mock.calls[1][0].map(
				(item) => item.remoteId
			)
		).toEqual(['b', 'c']);
		expect(b.acknowledge).toHaveBeenCalledTimes(1);
		expect(c.acknowledge).toHaveBeenCalledTimes(1);
	});
	it('ACKs accepted items independently and retries only failed items with the existing single route', async () => {
		jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
		const { queue, coordinator } = fixture();
		coordinator.completeHistoryArchiveObjects.mockResolvedValue(
			ok([ok(undefined), err(new Error('retry'))])
		);
		const a = delivery('a'),
			b = delivery('b');
		await Promise.all([queue.enqueue(a, ok({})), queue.enqueue(b, ok({}))]);
		await turns();
		expect(a.acknowledge).toHaveBeenCalledTimes(1);
		expect(b.acknowledge).not.toHaveBeenCalled();
		await jest.runAllTimersAsync();
		await queue.drain();
		expect(coordinator.completeHistoryArchiveObject).toHaveBeenCalledTimes(1);
		expect(coordinator.completeHistoryArchiveObject.mock.calls[0][0]).toBe('b');
		expect(b.acknowledge).toHaveBeenCalledTimes(1);
	});
	it('failed writes never ACK; exhausted retry NAKs and clears ownership', async () => {
		jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
		const { queue, coordinator } = fixture();
		coordinator.completeHistoryArchiveObjects.mockResolvedValue(
			err(new Error('unavailable'))
		);
		coordinator.completeHistoryArchiveObject.mockResolvedValue(
			err(new Error('unavailable'))
		);
		const a = delivery('a');
		expect(queue.claim('a')).toBe(true);
		await queue.enqueue(a, ok({}));
		await jest.runAllTimersAsync();
		await queue.drain();
		expect(a.acknowledge).not.toHaveBeenCalled();
		expect(a.retry).toHaveBeenCalledWith(30_000);
		expect(coordinator.completeHistoryArchiveObject).toHaveBeenCalledTimes(2);
		expect(queue.claim('a')).toBe(true);
	});
	it('retains existing failure route and evidence outcome', async () => {
		const { queue, coordinator, telemetry } = fixture();
		const a = delivery('a');
		await queue.enqueue(
			a,
			err({
				errorMessage: '404',
				errorType: 'missing',
				failureChannel: 'archive_error',
				httpStatus: 404
			})
		);
		await queue.drain();
		expect(coordinator.completeHistoryArchiveObjects).not.toHaveBeenCalled();
		expect(coordinator.failHistoryArchiveObject).toHaveBeenCalledTimes(1);
		expect(telemetry.finishObject).toHaveBeenCalledWith('a', 'archive_error');
	});
	it('duplicate in-process deliveries cannot replace the current owner', () => {
		const { queue } = fixture();
		expect(queue.claim('a')).toBe(true);
		expect(queue.claim('a')).toBe(false);
		queue.releaseClaim('a');
		expect(queue.claim('a')).toBe(true);
	});
	it('graceful close waits for durable persistence then ACK, with no early NAK', async () => {
		const { queue, coordinator } = fixture();
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValue(write.promise);
		const a = delivery('a');
		await queue.enqueue(a, ok({}));
		const closing = queue.close();
		expect(queue.close()).toBe(closing);
		expect(a.release).not.toHaveBeenCalled();
		write.resolve(ok([ok(undefined)]));
		await closing;
		expect(a.acknowledge).toHaveBeenCalledTimes(1);
		expect(a.release).not.toHaveBeenCalled();
	});
	it('timed-out close releases UNACKed delivery and ignores a late committed response', async () => {
		jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
		const { queue, coordinator, telemetry } = fixture(1);
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValue(write.promise);
		const a = delivery('a');
		await queue.enqueue(a, ok({}));
		const blocked = queue.enqueue(delivery('b'), ok({}));
		const rejected = expect(blocked).rejects.toThrow('stopping');
		const closing = queue.close();
		await jest.advanceTimersByTimeAsync(archiveObjectTerminalDrainTimeoutMs);
		await closing;
		await rejected;
		expect(a.release).toHaveBeenCalledTimes(1);
		expect(a.acknowledge).not.toHaveBeenCalled();
		write.resolve(ok([ok(undefined)]));
		await turns();
		expect(a.acknowledge).not.toHaveBeenCalled();
		expect(telemetry.finishObject).toHaveBeenCalledTimes(1);
		expect(telemetry.finishObject).toHaveBeenCalledWith('a', 'released');
	});
	it('crash before commit leaves recovery with the broker; after commit replay can ACK', async () => {
		const first = fixture(),
			restarted = fixture();
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		first.coordinator.completeHistoryArchiveObjects.mockReturnValue(
			write.promise
		);
		const original = delivery('a'),
			replay = delivery('a');
		await first.queue.enqueue(original, ok({}));
		expect(original.acknowledge).not.toHaveBeenCalled();
		// A different process can re-verify the broker redelivery; the API fences replay.
		await restarted.queue.enqueue(replay, ok({}));
		await restarted.queue.drain();
		expect(replay.acknowledge).toHaveBeenCalledTimes(1);
		write.resolve(ok([ok(undefined)]));
		await first.queue.drain();
	});
});
