import { WebSocket } from 'ws';
import { BoundedWebSocketSender } from '../BoundedWebSocketSender.js';

describe('BoundedWebSocketSender', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it('closes and deterministically terminates a backpressured client', () => {
		jest.useFakeTimers();
		const socket = createSocket(WebSocket.OPEN, 10);
		const cleanup = jest.fn();
		const sender = new BoundedWebSocketSender(socket, cleanup, undefined, {
			closeGraceMs: 10,
			maxBufferedBytes: 10
		});

		expect(sender.send('payload')).toBe(false);
		expect(socket.send).not.toHaveBeenCalled();
		expect(socket.close).toHaveBeenCalledWith(1013, 'backpressure');
		expect(cleanup).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(10);
		expect(socket.terminate).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it('cleans up when the send callback reports failure', () => {
		jest.useFakeTimers();
		const socket = createSocket(WebSocket.OPEN, 0);
		let sendCallback: ((error?: Error) => void) | undefined;
		socket.send.mockImplementation((_payload, callback) => {
			sendCallback = callback;
		});
		const cleanup = jest.fn();
		const sender = new BoundedWebSocketSender(socket, cleanup, undefined, {
			closeGraceMs: 10
		});

		expect(sender.send('payload')).toBe(true);
		sendCallback?.(new Error('write failed'));

		expect(socket.close).toHaveBeenCalledWith(1011, 'send failure');
		expect(cleanup).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(10);
		expect(socket.terminate).toHaveBeenCalledTimes(1);
	});

	it('rejects a send that would cross the buffered-byte cap', () => {
		jest.useFakeTimers();
		const socket = createSocket(WebSocket.OPEN, 6);
		const sender = new BoundedWebSocketSender(socket, jest.fn(), undefined, {
			closeGraceMs: 10,
			maxBufferedBytes: 10
		});

		expect(sender.send('12345')).toBe(false);
		expect(socket.send).not.toHaveBeenCalled();
		expect(socket.close).toHaveBeenCalledWith(1013, 'backpressure');
		jest.advanceTimersByTime(10);
	});

	it('cancels forced termination after a normal close event', () => {
		jest.useFakeTimers();
		const socket = createSocket(WebSocket.OPEN, 0);
		const cleanup = jest.fn();
		const sender = new BoundedWebSocketSender(socket, cleanup, undefined, {
			closeGraceMs: 10
		});

		sender.close();
		sender.markClosed();
		jest.advanceTimersByTime(20);

		expect(socket.close).toHaveBeenCalledWith(1001, 'closing');
		expect(socket.terminate).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});

function createSocket(readyState: number, bufferedAmount: number) {
	return {
		bufferedAmount,
		close: jest.fn(),
		readyState,
		send: jest.fn(),
		terminate: jest.fn()
	} as unknown as jest.Mocked<WebSocket>;
}
