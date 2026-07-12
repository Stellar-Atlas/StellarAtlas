/// <reference types="jest" />

import { subscribeToLiveNetworkStream } from '../live-network-stream';

describe('live network WebSocket ownership', () => {
	it('ignores a superseded socket close without opening a duplicate', () => {
		const harness = installWebSocketHarness();
		try {
			const unsubscribeFirst = subscribeToLiveNetworkStream(() => undefined);
			unsubscribeFirst();
			const unsubscribeSecond = subscribeToLiveNetworkStream(() => undefined);
			expect(harness.sockets).toHaveLength(2);

			harness.sockets[0]?.emit('close');
			const unsubscribeThird = subscribeToLiveNetworkStream(() => undefined);
			expect(harness.sockets).toHaveLength(2);

			unsubscribeThird();
			unsubscribeSecond();
		} finally {
			harness.restore();
		}
	});

	it('does not let a superseded socket error close the current socket', () => {
		const harness = installWebSocketHarness();
		try {
			const unsubscribeFirst = subscribeToLiveNetworkStream(() => undefined);
			unsubscribeFirst();
			const unsubscribeSecond = subscribeToLiveNetworkStream(() => undefined);

			harness.sockets[0]?.emit('error');
			expect(harness.sockets[1]?.closeCalls).toBe(0);
			const unsubscribeThird = subscribeToLiveNetworkStream(() => undefined);
			expect(harness.sockets).toHaveLength(2);

			unsubscribeThird();
			unsubscribeSecond();
		} finally {
			harness.restore();
		}
	});
});

type FakeSocketListener = (event: { readonly data?: unknown }) => void;

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	readonly listeners = new Map<string, FakeSocketListener[]>();
	closeCalls = 0;
	readyState = FakeWebSocket.CONNECTING;

	addEventListener(type: string, listener: FakeSocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	close(): void {
		this.closeCalls += 1;
		this.readyState = 3;
	}

	emit(type: string, event: { readonly data?: unknown } = {}): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function installWebSocketHarness(): {
	readonly restore: () => void;
	readonly sockets: FakeWebSocket[];
} {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const originalWebSocket = Object.getOwnPropertyDescriptor(
		globalThis,
		'WebSocket'
	);
	const sockets: FakeWebSocket[] = [];
	class TestWebSocket extends FakeWebSocket {
		constructor() {
			super();
			sockets.push(this);
		}
	}

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			clearTimeout,
			location: { hostname: 'localhost', origin: 'http://localhost' },
			setTimeout
		}
	});
	Object.defineProperty(globalThis, 'WebSocket', {
		configurable: true,
		value: TestWebSocket
	});

	return {
		restore: () => {
			restoreGlobal('window', originalWindow);
			restoreGlobal('WebSocket', originalWebSocket);
		},
		sockets
	};
}

function restoreGlobal(
	name: 'WebSocket' | 'window',
	descriptor: PropertyDescriptor | undefined
): void {
	if (descriptor === undefined) {
		Reflect.deleteProperty(globalThis, name);
		return;
	}
	Object.defineProperty(globalThis, name, descriptor);
}
