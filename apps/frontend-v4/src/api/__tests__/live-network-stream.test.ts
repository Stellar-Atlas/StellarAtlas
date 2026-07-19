/// <reference types="jest" />

import {
	getLiveNetworkStreamState,
	getLiveNetworkReconnectDelayMs,
	liveNetworkConnectTimeoutMs,
	liveNetworkReconnectBaseDelayMs,
	liveNetworkReconnectMaxDelayMs,
	liveNetworkWatchdogMs,
	subscribeToLiveNetworkStream
} from '../live-network-stream';
import {
	applyLiveScpMessage,
	createLiveScpConsumerState
} from '../live-scp-consumer-state';

const jest = import.meta.jest;

describe('live network WebSocket ownership', () => {
	it('shares one socket until the final subscriber leaves', () => {
		const harness = installWebSocketHarness();
		try {
			const unsubscribeFirst = subscribeToLiveNetworkStream(() => undefined);
			const unsubscribeSecond = subscribeToLiveNetworkStream(() => undefined);

			expect(harness.sockets).toHaveLength(1);
			unsubscribeFirst();
			expect(harness.sockets[0]?.closeCalls).toBe(0);

			unsubscribeSecond();
			expect(harness.sockets[0]?.closeCalls).toBe(1);
			harness.sockets[0]?.emit('close');
			expect(harness.sockets).toHaveLength(1);
			expect(getLiveNetworkStreamState().status).toBe('idle');
		} finally {
			harness.restore();
		}
	});

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

	it('adds the newest cursor to reconnects and deduplicates multi-page catch-up', () => {
		jest.useFakeTimers();
		const harness = installWebSocketHarness();
		let consumer = createLiveScpConsumerState([]);
		const states: string[] = [];
		const unsubscribe = subscribeToLiveNetworkStream(
			(message) => {
				if (message.type === 'scp') {
					consumer = applyLiveScpMessage(consumer, message);
				}
			},
			(state) => states.push(state.status)
		);
		try {
			const first = harness.sockets[0];
			first?.emit('open');
			first?.emit('message', {
				data: JSON.stringify(
					createScpMessage(
						[
							{
								observedAt: '2026-07-18T00:00:00.000Z',
								statementHash: 'statement-a'
							}
						],
						true
					)
				)
			});
			expect(getLiveNetworkStreamState()).toMatchObject({
				cursor: {
					observedAtMs: Date.parse('2026-07-18T00:00:00.000Z'),
					statementHash: 'statement-a'
				},
				truncated: true
			});

			first?.emit('close');
			jest.advanceTimersByTime(liveNetworkReconnectBaseDelayMs);
			expect(harness.sockets).toHaveLength(2);
			const reconnectUrl = new URL(harness.sockets[1]?.url ?? 'ws://invalid');
			expect(reconnectUrl.searchParams.get('afterObservedAtMs')).toBe(
				Date.parse('2026-07-18T00:00:00.000Z').toString()
			);
			expect(reconnectUrl.searchParams.get('afterStatementHash')).toBe(
				'statement-a'
			);

			const catchUpSocket = harness.sockets[1];
			catchUpSocket?.emit('open');
			catchUpSocket?.emit('message', {
				data: JSON.stringify(
					createScpMessage(
						[
							{
								observedAt: '2026-07-18T00:00:00.000Z',
								statementHash: 'statement-a'
							},
							{
								observedAt: '2026-07-18T00:00:01.000Z',
								statementHash: 'statement-b'
							}
						],
						true
					)
				)
			});
			expect(consumer.metadata).toMatchObject({ truncated: true });
			catchUpSocket?.emit('message', {
				data: JSON.stringify(
					createScpMessage(
						[
							{
								observedAt: '2026-07-18T00:00:01.000Z',
								statementHash: 'statement-b'
							},
							{
								observedAt: '2026-07-18T00:00:02.000Z',
								statementHash: 'statement-c'
							}
						],
						false
					)
				)
			});
			expect(
				consumer.statements.map((statement) => statement.statementHash)
			).toEqual(['statement-c', 'statement-b', 'statement-a']);
			expect(
				new Set(consumer.statements.map(({ statementHash }) => statementHash))
					.size
			).toBe(3);
			expect(consumer.metadata).toMatchObject({ truncated: false });
			expect(getLiveNetworkStreamState()).toMatchObject({
				cursor: {
					observedAtMs: Date.parse('2026-07-18T00:00:02.000Z'),
					statementHash: 'statement-c'
				}
			});
			expect(states).toContain('reconnecting');
		} finally {
			unsubscribe();
			harness.restore();
			jest.useRealTimers();
		}
	});

	it('retires a half-open socket and reconnects after the watchdog', () => {
		jest.useFakeTimers();
		const harness = installWebSocketHarness();
		const states: string[] = [];
		const unsubscribe = subscribeToLiveNetworkStream(
			() => undefined,
			(state) => states.push(state.status)
		);
		try {
			jest.advanceTimersByTime(liveNetworkConnectTimeoutMs);
			expect(harness.sockets[0]?.closeCalls).toBe(1);
			expect(states).toContain('stale');
			expect(getLiveNetworkStreamState().status).toBe('reconnecting');

			jest.advanceTimersByTime(liveNetworkReconnectBaseDelayMs);
			expect(harness.sockets).toHaveLength(2);
		} finally {
			unsubscribe();
			harness.restore();
			jest.useRealTimers();
		}
	});

	it('treats heartbeats as activity and bounds exponential reconnect delay', () => {
		expect(getLiveNetworkReconnectDelayMs(1)).toBe(
			liveNetworkReconnectBaseDelayMs
		);
		expect(getLiveNetworkReconnectDelayMs(2)).toBe(
			liveNetworkReconnectBaseDelayMs * 2
		);
		expect(getLiveNetworkReconnectDelayMs(31)).toBe(
			liveNetworkReconnectMaxDelayMs
		);

		jest.useFakeTimers();
		const harness = installWebSocketHarness();
		const unsubscribe = subscribeToLiveNetworkStream(() => undefined);
		try {
			const candidate = harness.sockets[0];
			candidate?.emit('open');
			jest.advanceTimersByTime(liveNetworkWatchdogMs - 1);
			candidate?.emit('message', {
				data: JSON.stringify({
					payload: { observedAt: '2026-07-18T00:00:00.000Z' },
					type: 'heartbeat'
				})
			});
			jest.advanceTimersByTime(liveNetworkWatchdogMs - 1);
			expect(candidate?.closeCalls).toBe(0);
			jest.advanceTimersByTime(1);
			expect(candidate?.closeCalls).toBe(1);
		} finally {
			unsubscribe();
			harness.restore();
			jest.useRealTimers();
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

	constructor(readonly url = '') {}

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
		if (type === 'open') this.readyState = FakeWebSocket.OPEN;
		if (type === 'close') this.readyState = 3;
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
		constructor(url: string) {
			super(url);
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

interface ScpMessageStatement {
	readonly observedAt: string;
	readonly statementHash: string;
}

function createScpMessage(
	statements: readonly ScpMessageStatement[],
	truncated: boolean
) {
	const latest = statements.at(-1);
	if (latest === undefined) throw new Error('SCP message requires a statement');
	return {
		cursor: {
			observedAtMs: Date.parse(latest.observedAt),
			statementHash: latest.statementHash
		},
		freshness: 'fresh',
		freshnessMs: 100,
		observedAt: latest.observedAt,
		payload: statements.map(({ observedAt, statementHash }) => ({
			nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
			observedAt,
			observedFromAddress: '127.0.0.1:11625',
			observedFromPeer:
				'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
			pledges: {
				accepted: [],
				quorumSetHash: `quorum-${statementHash}`,
				votes: []
			},
			signature: '',
			slotIndex: '70000000',
			statementHash,
			statementType: 'nominate',
			statementXdr: '',
			values: [
				{
					closeTime: observedAt,
					txSetHash: `tx-${statementHash}`,
					upgradeCount: 1,
					value: `value-${statementHash}`
				}
			]
		})),
		source: 'postgres_canonical',
		truncated,
		type: 'scp'
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
