import { buildBrowserRealtimeUrl } from './browser-client';
import {
	parseLiveNetworkMessage,
	type LiveNetworkMessage
} from './live-network-message-parser';
import type { PublicScpStatementCursor } from './types';

export type { LiveNetworkMessage } from './live-network-message-parser';

export type LiveNetworkChannel = 'summary' | 'network' | 'scp';
export interface LiveNetworkSubscriptionOptions {
	readonly channels: readonly LiveNetworkChannel[];
	readonly scpMode?: 'graph';
}
type LiveSubscriptionProfile = LiveNetworkSubscriptionOptions;

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
const subscriptionOptions = new Map<LiveNetworkListener, LiveNetworkSubscriptionOptions>();
let reconnectAttempt = 0;
let reconnectTimeout: number | null = null;
let resumeCursor: PublicScpStatementCursor | null = null;
let socket: WebSocket | null = null;
let watchdogTimeout: number | null = null;
let activeProfileKey = '';
let visibilityListenerInstalled = false;
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
	for (const listener of listeners) {
		const options = subscriptionOptions.get(listener);
		if (options === undefined || acceptsMessage(options, message)) listener(message);
	}
};
const acceptsMessage = (options: LiveNetworkSubscriptionOptions, message: LiveNetworkMessage): boolean => {
	if (message.type === 'heartbeat' || message.type === 'error') return true;
	if (message.type === 'summary') return options.channels.includes('summary');
	if (message.type === 'latestLedger') {
		return options.channels.includes('network') || options.channels.includes('summary');
	}
	if (message.type === 'network') return options.channels.includes('network');
	return options.channels.includes('scp');
};

const getSubscriptionProfile = (): LiveSubscriptionProfile => {
	const channels = new Set<LiveNetworkChannel>();
	let graphMode = false;
	let fullScpRequired = false;
	for (const options of subscriptionOptions.values()) {
		for (const channel of options.channels) channels.add(channel);
		if (options.scpMode === 'graph' && options.channels.includes('scp')) graphMode = true;
		if (options.scpMode !== 'graph' && options.channels.includes('scp')) fullScpRequired = true;
	}
	return {
		channels: (['summary', 'network', 'scp'] as const).filter((channel) => channels.has(channel)),
		...(graphMode && !fullScpRequired ? { scpMode: 'graph' as const } : {})
	};
};

const profileKey = (profile: LiveSubscriptionProfile): string =>
	`${profile.channels.join(',')}|${profile.scpMode ?? ''}`;

const visible = (): boolean =>
	typeof document === 'undefined' || document.visibilityState !== 'hidden';

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
	if (message.type !== 'scp' && message.type !== 'scpGraph') return null;
	let newest: PublicScpStatementCursor | null = null;
	for (const statement of message.payload) {
		const observedAtMs = Date.parse(statement.observedAt);
		if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) continue;
		const cursor = { observedAtMs, statementHash: statement.statementHash };
		if (newest === null || compareCursors(cursor, newest) > 0) newest = cursor;
	}
	return newest;
};

const buildLiveNetworkUrl = (profile: LiveSubscriptionProfile): string => {
	const url = new URL(buildBrowserRealtimeUrl(liveWebSocketPath));
	url.searchParams.set('channels', profile.channels.join(','));
	if (profile.scpMode !== undefined) url.searchParams.set('scpMode', profile.scpMode);
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
	if (
		listeners.size === 0 ||
		!visible() ||
		getSubscriptionProfile().channels.length === 0 ||
		reconnectTimeout !== null
	) return;
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
		if (message.type === 'scp' || message.type === 'scpGraph' || message.type === 'heartbeat') {
			advanceResumeCursor(message.cursor);
		}
		if (message.type === 'scp' || message.type === 'scpGraph') {
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
	if (listeners.size === 0 || !visible()) return;
	const profile = getSubscriptionProfile();
	if (profile.channels.length === 0) return;
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING)
	)
		return;

	clearReconnectTimeout();
	const candidate = new WebSocket(buildLiveNetworkUrl(profile));
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
const onVisibilityChange = (): void => {
	if (!visible()) {
		clearReconnectTimeout();
		closeSocket();
		setStreamState({ status: 'idle' });
		return;
	}
	resumeCursor = null;
	reconnectAttempt = 0;
	activeProfileKey = '';
	updateSubscriptionConnection();
};

const updateSubscriptionConnection = (): void => {
	if (listeners.size === 0) return;
	if (!visible()) {
		clearReconnectTimeout();
		closeSocket();
		setStreamState({ status: 'idle' });
		return;
	}
	const profile = getSubscriptionProfile();
	const nextKey = profileKey(profile);
	if (nextKey === activeProfileKey) {
		connectLiveNetworkStream();
		return;
	}
	const previousChannels = activeProfileKey.split('|')[0]?.split(',') ?? [];
	const previousMode = activeProfileKey.split('|')[1] ?? '';
	if (previousChannels.includes('scp') !== profile.channels.includes('scp') ||
		previousMode !== (profile.scpMode ?? '')) resumeCursor = null;
	activeProfileKey = nextKey;
	clearReconnectTimeout();
	closeSocket();
	connectLiveNetworkStream();
};

const installVisibilityListener = (): void => {
	if (visibilityListenerInstalled || typeof document === 'undefined') return;
	document.addEventListener('visibilitychange', onVisibilityChange);
	visibilityListenerInstalled = true;
};

const removeVisibilityListener = (): void => {
	if (!visibilityListenerInstalled || typeof document === 'undefined') return;
	document.removeEventListener('visibilitychange', onVisibilityChange);
	visibilityListenerInstalled = false;
};

export const subscribeToLiveNetworkStream = (
	listener: LiveNetworkListener,
	stateListener?: LiveNetworkStateListener,
	options: LiveNetworkSubscriptionOptions = { channels: ['summary', 'network', 'scp'] }
): (() => void) => {
	listeners.add(listener);
	subscriptionOptions.set(listener, options);
	if (stateListener !== undefined) {
		stateListeners.add(stateListener);
		stateListener(streamState);
	}
	installVisibilityListener();
	updateSubscriptionConnection();

	return () => {
		listeners.delete(listener);
		subscriptionOptions.delete(listener);
		if (stateListener !== undefined) stateListeners.delete(stateListener);
		if (listeners.size > 0) {
			updateSubscriptionConnection();
			return;
		}
		clearReconnectTimeout();
		closeSocket();
		removeVisibilityListener();
		activeProfileKey = '';
		reconnectAttempt = 0;
		resumeCursor = null;
		streamState = createIdleState();
	};
};
