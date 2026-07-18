import { buildBrowserRealtimeUrl } from './browser-client';
import {
	parseLiveNetworkMessage,
	type LiveNetworkMessage
} from './live-network-message-parser';
import type { PublicScpStatementCursor } from './types';

export type { LiveNetworkMessage } from './live-network-message-parser';

export type LiveNetworkStreamStatus =
	'connecting' | 'idle' | 'open' | 'reconnecting' | 'stale';

export interface LiveNetworkStreamState {
	readonly cursor: PublicScpStatementCursor | null;
	readonly lastActivityAt: number | null;
	readonly reconnectAttempt: number;
	readonly status: LiveNetworkStreamStatus;
	readonly truncated: boolean;
}

type LiveNetworkListener = (message: LiveNetworkMessage) => void;
type LiveNetworkStateListener = (state: LiveNetworkStreamState) => void;

export const liveNetworkConnectTimeoutMs = 10_000;
export const liveNetworkWatchdogMs = 12_000;
export const liveNetworkReconnectBaseDelayMs = 500;
export const liveNetworkReconnectMaxDelayMs = 15_000;

const liveWebSocketPath = '/v1/live/ws';
const listeners = new Set<LiveNetworkListener>();
const stateListeners = new Set<LiveNetworkStateListener>();
let reconnectAttempt = 0;
let reconnectTimeout: number | null = null;
let resumeCursor: PublicScpStatementCursor | null = null;
let socket: WebSocket | null = null;
let watchdogTimeout: number | null = null;
let streamState: LiveNetworkStreamState = createIdleState();

function createIdleState(): LiveNetworkStreamState {
	return {
		cursor: null,
		lastActivityAt: null,
		reconnectAttempt: 0,
		status: 'idle',
		truncated: false
	};
}

export const getLiveNetworkStreamState = (): LiveNetworkStreamState =>
	streamState;

const setStreamState = (update: Partial<LiveNetworkStreamState>): void => {
	streamState = { ...streamState, ...update };
	for (const listener of stateListeners) listener(streamState);
};

const notify = (message: LiveNetworkMessage): void => {
	for (const listener of listeners) listener(message);
};

const clearReconnectTimeout = (): void => {
	if (reconnectTimeout === null) return;
	window.clearTimeout(reconnectTimeout);
	reconnectTimeout = null;
};

const clearWatchdogTimeout = (): void => {
	if (watchdogTimeout === null) return;
	window.clearTimeout(watchdogTimeout);
	watchdogTimeout = null;
};

export const getLiveNetworkReconnectDelayMs = (attempt: number): number =>
	Math.min(
		liveNetworkReconnectMaxDelayMs,
		liveNetworkReconnectBaseDelayMs *
			2 ** Math.min(10, Math.max(0, attempt - 1))
	);

const compareCursors = (
	left: PublicScpStatementCursor,
	right: PublicScpStatementCursor
): number =>
	left.observedAtMs - right.observedAtMs ||
	left.statementHash.localeCompare(right.statementHash);

const advanceResumeCursor = (
	candidate: PublicScpStatementCursor | null | undefined
): void => {
	if (
		candidate === null ||
		candidate === undefined ||
		(resumeCursor !== null && compareCursors(candidate, resumeCursor) <= 0)
	)
		return;
	resumeCursor = candidate;
};

const cursorFromMessage = (
	message: LiveNetworkMessage
): PublicScpStatementCursor | null => {
	if (message.type !== 'scp') return null;
	let newest: PublicScpStatementCursor | null = null;
	for (const statement of message.payload) {
		const observedAtMs = Date.parse(statement.observedAt);
		if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) continue;
		const cursor = { observedAtMs, statementHash: statement.statementHash };
		if (newest === null || compareCursors(cursor, newest) > 0) newest = cursor;
	}
	return newest;
};

const buildLiveNetworkUrl = (): string => {
	const url = new URL(buildBrowserRealtimeUrl(liveWebSocketPath));
	if (resumeCursor !== null) {
		url.searchParams.set(
			'afterObservedAtMs',
			resumeCursor.observedAtMs.toString()
		);
		url.searchParams.set('afterStatementHash', resumeCursor.statementHash);
	}
	return url.toString();
};

const scheduleReconnect = (): void => {
	if (listeners.size === 0 || reconnectTimeout !== null) return;
	reconnectAttempt = Math.min(31, reconnectAttempt + 1);
	setStreamState({ reconnectAttempt, status: 'reconnecting' });
	reconnectTimeout = window.setTimeout(() => {
		reconnectTimeout = null;
		connectLiveNetworkStream();
	}, getLiveNetworkReconnectDelayMs(reconnectAttempt));
};

const retireSocket = (candidate: WebSocket): void => {
	if (socket !== candidate) return;
	socket = null;
	clearWatchdogTimeout();
	candidate.close(4000, 'live stream retired');
	scheduleReconnect();
};

const armWatchdog = (candidate: WebSocket, delayMs: number): void => {
	clearWatchdogTimeout();
	watchdogTimeout = window.setTimeout(() => {
		watchdogTimeout = null;
		if (socket !== candidate) return;
		setStreamState({ status: 'stale' });
		retireSocket(candidate);
	}, delayMs);
};

const recordActivity = (candidate: WebSocket): void => {
	if (socket !== candidate) return;
	reconnectAttempt = 0;
	setStreamState({
		cursor: resumeCursor,
		lastActivityAt: Date.now(),
		reconnectAttempt,
		status: 'open'
	});
	armWatchdog(candidate, liveNetworkWatchdogMs);
};

const handleSocketMessage = (
	candidate: WebSocket,
	event: MessageEvent<unknown>
): void => {
	if (socket !== candidate) return;
	if (typeof event.data !== 'string') {
		recordActivity(candidate);
		notify({
			payload: { message: 'Live stream message was not text' },
			type: 'error'
		});
		return;
	}
	try {
		const message = parseLiveNetworkMessage(JSON.parse(event.data));
		if (message === null) {
			recordActivity(candidate);
			notify({
				payload: { message: 'Live stream message failed validation' },
				type: 'error'
			});
			return;
		}
		advanceResumeCursor(cursorFromMessage(message));
		if (message.type === 'scp' || message.type === 'heartbeat') {
			advanceResumeCursor(message.cursor);
		}
		if (message.type === 'scp') {
			setStreamState({ truncated: message.truncated === true });
		}
		recordActivity(candidate);
		notify(message);
	} catch {
		recordActivity(candidate);
		notify({
			payload: { message: 'Live stream message was not valid JSON' },
			type: 'error'
		});
	}
};

const connectLiveNetworkStream = (): void => {
	if (typeof window === 'undefined') return;
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING)
	)
		return;

	clearReconnectTimeout();
	const candidate = new WebSocket(buildLiveNetworkUrl());
	socket = candidate;
	setStreamState({
		cursor: resumeCursor,
		reconnectAttempt,
		status: reconnectAttempt === 0 ? 'connecting' : 'reconnecting'
	});
	armWatchdog(candidate, liveNetworkConnectTimeoutMs);
	candidate.addEventListener('open', () => {
		if (socket !== candidate) return;
		setStreamState({ lastActivityAt: Date.now(), status: 'open' });
		armWatchdog(candidate, liveNetworkWatchdogMs);
	});
	candidate.addEventListener('message', (event) =>
		handleSocketMessage(candidate, event)
	);
	candidate.addEventListener('close', () => {
		if (socket !== candidate) return;
		socket = null;
		clearWatchdogTimeout();
		scheduleReconnect();
	});
	candidate.addEventListener('error', () => retireSocket(candidate));
};

const closeSocket = (): void => {
	const currentSocket = socket;
	socket = null;
	clearWatchdogTimeout();
	currentSocket?.close(1000, 'no live stream subscribers');
};

export const subscribeToLiveNetworkStream = (
	listener: LiveNetworkListener,
	stateListener?: LiveNetworkStateListener
): (() => void) => {
	listeners.add(listener);
	if (stateListener !== undefined) {
		stateListeners.add(stateListener);
		stateListener(streamState);
	}
	connectLiveNetworkStream();

	return () => {
		listeners.delete(listener);
		if (stateListener !== undefined) stateListeners.delete(stateListener);
		if (listeners.size > 0) return;
		clearReconnectTimeout();
		closeSocket();
		reconnectAttempt = 0;
		resumeCursor = null;
		streamState = createIdleState();
	};
};
