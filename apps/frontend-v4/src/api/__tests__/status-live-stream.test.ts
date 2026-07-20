import { subscribeToStatusStream } from '../status-live-stream';

describe('status WebSocket lifecycle', () => {
	it('ignores a superseded socket close without opening a duplicate', () => {
		const harness = installSocketHarness();
		try {
			const unsubscribeFirst = subscribeToStatusStream(() => undefined);
			unsubscribeFirst();
			const unsubscribeSecond = subscribeToStatusStream(() => undefined);
			expect(harness.sockets).toHaveLength(2);

			harness.sockets[0]?.emit('close');
			const unsubscribeThird = subscribeToStatusStream(() => undefined);
			expect(harness.sockets).toHaveLength(2);

			unsubscribeThird();
			unsubscribeSecond();
		} finally {
			harness.restore();
		}
	});

	it('shares one status socket until the final subscriber leaves', () => {
		const harness = installSocketHarness();
		try {
			const unsubscribeFirst = subscribeToStatusStream(() => undefined);
			const unsubscribeSecond = subscribeToStatusStream(() => undefined);

			expect(harness.sockets).toHaveLength(1);
			unsubscribeFirst();
			expect(harness.sockets[0]?.closeCalls).toBe(0);

			unsubscribeSecond();
			expect(harness.sockets[0]?.closeCalls).toBe(1);
			harness.sockets[0]?.emit('close');
			expect(harness.sockets).toHaveLength(1);
		} finally {
			harness.restore();
		}
	});

	it('reconnects when a proxy leaves the status socket half-open', () => {
		const harness = installSocketHarness();
		try {
			const unsubscribe = subscribeToStatusStream(() => undefined);
			expect(harness.sockets).toHaveLength(1);

			harness.sockets[0]?.emit('open');
			expect(harness.timers.size).toBe(1);
			runLatestTimer(harness.timers);
			expect(harness.sockets[0]?.closeCalls).toBe(1);

			runLatestTimer(harness.timers);
			expect(harness.sockets).toHaveLength(2);
			unsubscribe();
		} finally {
			harness.restore();
		}
	});
});

interface SocketHarness {
	readonly restore: () => void;
	readonly sockets: FakeWebSocket[];
	readonly timers: Map<number, () => void>;
}

function installSocketHarness(): SocketHarness {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const originalWebSocket = Object.getOwnPropertyDescriptor(
		globalThis,
		'WebSocket'
	);
	const sockets: FakeWebSocket[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 1;
	class TestWebSocket extends FakeWebSocket {
		constructor() {
			super();
			sockets.push(this);
		}
	}

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			clearTimeout: (timer: number) => timers.delete(timer),
			location: { hostname: 'localhost', origin: 'http://localhost' },
			setTimeout: (callback: () => void) => {
				const timer = nextTimer++;
				timers.set(timer, callback);
				return timer;
			}
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
		sockets,
		timers
	};
}

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

function runLatestTimer(timers: Map<number, () => void>): void {
	const latest = [...timers.entries()].at(-1);
	if (latest === undefined) throw new Error('Expected a scheduled timer');
	timers.delete(latest[0]);
	latest[1]();
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
