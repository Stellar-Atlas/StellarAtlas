import type {
	PublicLatestLedger,
	PublicNetwork,
	PublicScpStatementObservation
} from './types';
import { buildBrowserRealtimeUrl } from './browser-client';

export type LiveNetworkMessage =
	| { payload: PublicLatestLedger; type: 'latestLedger' }
	| { payload: PublicNetwork; type: 'network' }
	| { payload: PublicScpStatementObservation[]; type: 'scp' }
	| { payload: { message: string }; type: 'error' };

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
	socket = new WebSocket(buildBrowserRealtimeUrl(liveWebSocketPath));
	socket.addEventListener('message', (event) => {
		try {
			notify(JSON.parse(event.data as string) as LiveNetworkMessage);
		} catch {
			notify({
				payload: { message: 'Live stream message was not valid JSON' },
				type: 'error'
			});
		}
	});
	socket.addEventListener('close', () => {
		socket = null;
		scheduleReconnect();
	});
	socket.addEventListener('error', () => {
		closeSocket();
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
