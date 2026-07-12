import { buildBrowserRealtimeUrl } from './browser-client';
import {
	parseStatusLivePayload,
	type StatusLivePatch,
	type StatusLiveSnapshot
} from './status-live-contract';
export type { StatusLiveSnapshot } from './status-live-contract';

export type StatusLiveMessage =
	| {
			readonly payload: StatusLivePatch;
			readonly type: 'status-patch';
	  }
	| { readonly payload: StatusLiveSnapshot; readonly type: 'status' }
	| { readonly payload: { readonly message: string }; readonly type: 'error' };

type StatusLiveListener = (message: StatusLiveMessage) => void;

const statusWebSocketPath = '/v1/status/ws';
const reconnectDelayMs = 1_500;
const listeners = new Set<StatusLiveListener>();
let reconnectTimeout: number | null = null;
let socket: WebSocket | null = null;

export function parseStatusLiveMessage(
	value: unknown
): StatusLiveMessage | null {
	if (!isRecord(value) || typeof value.type !== 'string') return null;
	if (value.type === 'error') {
		if (!isRecord(value.payload) || typeof value.payload.message !== 'string') {
			return null;
		}
		return {
			payload: { message: value.payload.message },
			type: 'error'
		};
	}
	if (value.type !== 'status' && value.type !== 'status-patch') return null;
	if (!isRecord(value.payload)) return null;

	const payload = parseStatusLivePayload(
		value.payload,
		value.type === 'status'
	);
	if (payload === null) return null;

	if (value.type === 'status') {
		return {
			payload: payload as StatusLiveSnapshot,
			type: 'status'
		};
	}

	return {
		payload,
		type: 'status-patch'
	};
}

const clearReconnectTimeout = (): void => {
	if (reconnectTimeout === null) return;
	window.clearTimeout(reconnectTimeout);
	reconnectTimeout = null;
};

const notify = (message: StatusLiveMessage): void => {
	for (const listener of listeners) listener(message);
};

const closeSocket = (): void => {
	const currentSocket = socket;
	socket = null;
	currentSocket?.close();
};

const scheduleReconnect = (): void => {
	if (listeners.size === 0 || reconnectTimeout !== null) return;
	reconnectTimeout = window.setTimeout(() => {
		reconnectTimeout = null;
		connectStatusStream();
	}, reconnectDelayMs);
};

const connectStatusStream = (): void => {
	if (typeof window === 'undefined') return;
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING)
	) {
		return;
	}

	clearReconnectTimeout();
	const candidate = new WebSocket(buildBrowserRealtimeUrl(statusWebSocketPath));
	socket = candidate;
	candidate.addEventListener('message', (event) => {
		if (socket !== candidate) return;
		try {
			const message = parseStatusLiveMessage(JSON.parse(event.data as string));
			if (message !== null) {
				notify(message);
				return;
			}
			notify({
				payload: { message: 'Status stream message was invalid' },
				type: 'error'
			});
		} catch {
			notify({
				payload: { message: 'Status stream message was not valid JSON' },
				type: 'error'
			});
		}
	});
	candidate.addEventListener('close', () => {
		if (socket !== candidate) return;
		socket = null;
		scheduleReconnect();
	});
	candidate.addEventListener('error', () => {
		candidate.close();
	});
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const subscribeToStatusStream = (
	listener: StatusLiveListener
): (() => void) => {
	listeners.add(listener);
	connectStatusStream();

	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		clearReconnectTimeout();
		closeSocket();
	};
};
