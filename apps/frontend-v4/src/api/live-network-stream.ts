import { buildBrowserRealtimeUrl } from './browser-client';
import {
	parseLiveNetworkMessage,
	type LiveNetworkMessage
} from './live-network-message-parser';

export type { LiveNetworkMessage } from './live-network-message-parser';

type LiveNetworkListener = (message: LiveNetworkMessage) => void;

const liveWebSocketPath = '/v1/live/ws';
const reconnectDelayMs = 1_500;
const listeners = new Set<LiveNetworkListener>();
let reconnectTimeout: number | null = null;
let socket: WebSocket | null = null;

const clearReconnectTimeout = (): void => {
	if (reconnectTimeout === null) return;
	window.clearTimeout(reconnectTimeout);
	reconnectTimeout = null;
};

const notify = (message: LiveNetworkMessage): void => {
	for (const listener of listeners) listener(message);
};

const scheduleReconnect = (): void => {
	if (listeners.size === 0 || reconnectTimeout !== null) return;
	reconnectTimeout = window.setTimeout(() => {
		reconnectTimeout = null;
		connectLiveNetworkStream();
	}, reconnectDelayMs);
};

const closeSocket = (): void => {
	const currentSocket = socket;
	socket = null;
	currentSocket?.close();
};

const connectLiveNetworkStream = (): void => {
	if (typeof window === 'undefined') return;
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING)
	) {
		return;
	}

	clearReconnectTimeout();
	const candidate = new WebSocket(buildBrowserRealtimeUrl(liveWebSocketPath));
	socket = candidate;
	candidate.addEventListener('message', (event) => {
		if (socket !== candidate) return;
		if (typeof event.data !== 'string') {
			notify({
				payload: { message: 'Live stream message was not text' },
				type: 'error'
			});
			return;
		}
		try {
			const message = parseLiveNetworkMessage(JSON.parse(event.data));
			notify(
				message ?? {
					payload: { message: 'Live stream message failed validation' },
					type: 'error'
				}
			);
		} catch {
			notify({
				payload: { message: 'Live stream message was not valid JSON' },
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

export const subscribeToLiveNetworkStream = (
	listener: LiveNetworkListener
): (() => void) => {
	listeners.add(listener);
	connectLiveNetworkStream();

	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		clearReconnectTimeout();
		closeSocket();
	};
};
