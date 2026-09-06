import type { Serializable } from 'node:child_process';
import { sendApiWorkerMessage, type ApiIpcWorker } from '../ApiClusterIpc.js';

const message = { type: 'best-effort-status' };
const closed = (): Error =>
	Object.assign(new Error('Channel closed'), {
		code: 'ERR_IPC_CHANNEL_CLOSED'
	});
function workerFixture(implementation: ApiIpcWorker['send']) {
	return {
		id: 7,
		isConnected: jest.fn(() => true),
		send: jest.fn(implementation)
	};
}
describe('API cluster best-effort IPC', () => {
	it('consumes the asynchronous closed-channel race after a connected precheck', async () => {
		const worker = workerFixture((_message, callback) => {
			queueMicrotask(() => callback(closed()));
			return false;
		});
		const log = jest.fn();
		expect(() => sendApiWorkerMessage(worker, message, log)).not.toThrow();
		await Promise.resolve();
		expect(worker.send).toHaveBeenCalledWith(message, expect.any(Function));
		expect(log).not.toHaveBeenCalled();
	});
	it('skips a disconnected worker without sending or retrying', () => {
		const worker = workerFixture(() => true);
		worker.isConnected.mockReturnValue(false);
		const log = jest.fn();
		sendApiWorkerMessage(worker, message, log);
		expect(worker.send).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});
	it('contains a synchronous closed-channel throw', () => {
		const worker = workerFixture(() => {
			throw closed();
		});
		const log = jest.fn();
		expect(() => sendApiWorkerMessage(worker, message, log)).not.toThrow();
		expect(log).not.toHaveBeenCalled();
	});
	it('logs unexpected asynchronous send errors without retrying', async () => {
		const error = Object.assign(new Error('Unexpected transport failure'), {
			code: 'EIO'
		});
		const worker = workerFixture((_message: Serializable, callback) => {
			queueMicrotask(() => callback(error));
			return false;
		});
		const log = jest.fn();
		sendApiWorkerMessage(worker, message, log);
		await Promise.resolve();
		expect(log).toHaveBeenCalledWith(7, error);
		expect(worker.send).toHaveBeenCalledTimes(1);
	});
	it('logs unexpected synchronous errors without escaping the broadcast loop', () => {
		const error = new Error('Serialization failed');
		const worker = workerFixture(() => {
			throw error;
		});
		const log = jest.fn();
		expect(() => sendApiWorkerMessage(worker, message, log)).not.toThrow();
		expect(log).toHaveBeenCalledWith(7, error);
	});
	it('does not retry a backpressured send whose callback succeeds', async () => {
		const worker = workerFixture((_message, callback) => {
			queueMicrotask(() => callback(null));
			return false;
		});
		const log = jest.fn();
		sendApiWorkerMessage(worker, message, log);
		await Promise.resolve();
		expect(worker.send).toHaveBeenCalledTimes(1);
		expect(log).not.toHaveBeenCalled();
	});
});
