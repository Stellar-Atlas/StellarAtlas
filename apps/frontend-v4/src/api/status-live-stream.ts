import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectSummary,
	PublicScanLogStatus,
	PublicWorkerStatus
} from './types';
import { buildBrowserRealtimeUrl } from './browser-client';

export interface StatusLiveSnapshot {
	readonly api: PublicApiStatus;
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveSummary: PublicHistoryArchiveObjectSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly generatedAt: string;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export type StatusLiveMessage =
	| { readonly payload: StatusLiveSnapshot; readonly type: 'status' }
	| { readonly payload: { readonly message: string }; readonly type: 'error' };

type StatusLiveListener = (message: StatusLiveMessage) => void;

const statusWebSocketPath = '/v1/status/ws';
const reconnectDelayMs = 1_500;
const listeners = new Set<StatusLiveListener>();
let reconnectTimeout: number | null = null;
let socket: WebSocket | null = null;

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
	socket = new WebSocket(buildBrowserRealtimeUrl(statusWebSocketPath));
	socket.addEventListener('message', (event) => {
		try {
			notify(JSON.parse(event.data as string) as StatusLiveMessage);
		} catch {
			notify({
				payload: { message: 'Status stream message was not valid JSON' },
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
