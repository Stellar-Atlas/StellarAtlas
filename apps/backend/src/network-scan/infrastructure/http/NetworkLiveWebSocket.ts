import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Logger } from '@core/services/Logger.js';
import { WebSocket, WebSocketServer } from 'ws';
import type { NetworkV1, ScpStatementObservationV1 } from 'shared';
import type { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import type {
	GetScpStatements,
	ScpStatementReadFreshness,
	ScpStatementReadSource
} from '../../use-cases/get-scp-statements/GetScpStatements.js';
import type {
	GetLatestObservedLedger,
	LatestObservedLedgerDTO
} from '../../use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import { fetchLatestLedger } from './HorizonLedgerClient.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';
import { getSharedScpStatementLiveHub } from './ScpStatementLiveHub.js';
import { BoundedWebSocketSender } from './BoundedWebSocketSender.js';
import { isWithinScpStatementTransportCeiling } from './ScpStatementTransportPolicy.js';
import type { ScpStatementLiveCursor } from '../../domain/scp/ScpStatementLiveStore.js';

interface NetworkLiveWebSocketConfig {
	getLatestObservedLedger: GetLatestObservedLedger;
	getNetwork: GetNetwork;
	getScpStatements: GetScpStatements;
	horizonUrl: string;
	logger?: Logger;
	path?: string;
}

type LiveMessage =
	| { payload: unknown; type: 'network' | 'summary' | 'latestLedger' }
	| {
			cursor: ScpStatementLiveCursor | null;
			freshness: ScpStatementReadFreshness;
			freshnessMs: number | null;
			observedAt: string | null;
			payload: unknown;
			source: ScpStatementReadSource;
			truncated: boolean;
			type: 'scp' | 'scpGraph';
	  }
	| { payload: { message: string }; type: 'error' }
	| { payload: { observedAt: string }; type: 'heartbeat' };

type LiveLatestLedgerDTO =
	| LatestObservedLedgerDTO
	| {
			readonly closedAt: string;
			readonly freshness: 'fresh' | 'stale';
			readonly freshnessMs: number;
			readonly observedAt: string;
			readonly protocolVersion: number;
			readonly sequence: string;
			readonly source: 'horizon_fallback';
	  };

interface LiveChannels {
	readonly network: boolean;
	readonly summary: boolean;
	readonly scp: boolean;
	readonly scpMode: 'full' | 'graph';
}

interface LiveClient {
	channels: LiveChannels;
	scpUnsubscribe: () => void;
	sender: BoundedWebSocketSender;
}

const defaultPath = '/v1/live/ws';
const latestLedgerIntervalMs = 2_000;
const latestLedgerFailureInitialRetryMs = 5_000;
const latestLedgerFailureMaximumRetryMs = 60_000;
const networkIntervalMs = 5_000;
const heartbeatIntervalMs = 5_000;

const isWebSocketPath = (request: IncomingMessage, path: string): boolean => {
	if (!request.url) return false;
	const url = new URL(request.url, 'http://127.0.0.1');
	return url.pathname === path;
};

export type NetworkLiveResumeCursorParseResult =
	| { readonly cursor: ScpStatementLiveCursor | null; readonly valid: true }
	| { readonly valid: false };

export function parseNetworkLiveResumeCursor(
	requestUrl: string | undefined
): NetworkLiveResumeCursorParseResult {
	if (requestUrl === undefined) return { cursor: null, valid: true };
	const parameters = new URL(requestUrl, 'http://127.0.0.1').searchParams;
	const observedAtValues = parameters.getAll('afterObservedAtMs');
	const statementHashValues = parameters.getAll('afterStatementHash');
	if (observedAtValues.length === 0 && statementHashValues.length === 0) {
		return { cursor: null, valid: true };
	}
	if (observedAtValues.length !== 1 || statementHashValues.length !== 1) {
		return { valid: false };
	}
	const observedAtMs = Number(observedAtValues[0]);
	const statementHash = statementHashValues[0] ?? '';
	if (
		!Number.isSafeInteger(observedAtMs) ||
		observedAtMs < 0 ||
		statementHash.trim().length === 0
	) {
		return { valid: false };
	}
	return { cursor: { observedAtMs, statementHash }, valid: true };
}

export type NetworkLiveChannelsParseResult =
	| { readonly channels: LiveChannels; readonly valid: true }
	| { readonly valid: false };

export function parseNetworkLiveChannels(
	requestUrl: string | undefined
): NetworkLiveChannelsParseResult {
	const parameters = new URL(requestUrl ?? '/', 'http://127.0.0.1').searchParams;
	const values = parameters.getAll('channels');
	const modes = parameters.getAll('scpMode');
	if (values.length === 0) {
		if (modes.length > 0) return { valid: false };
		return {
			channels: { network: true, scp: true, scpMode: 'full', summary: false },
			valid: true
		};
	}
	if (values.length !== 1 || modes.length > 1) return { valid: false };
	const requested = values[0]!.split(',');
	const allowed = new Set(['summary', 'network', 'scp']);
	if (
		requested.some((value) => !allowed.has(value)) ||
		new Set(requested).size !== requested.length ||
		requested.some((value) => value.length === 0)
	) {
		return { valid: false };
	}
	const scp = requested.includes('scp');
	const mode = modes[0];
	if (mode !== undefined && (mode !== 'graph' || !scp)) {
		return { valid: false };
	}
	return {
		channels: {
			network: requested.includes('network'),
			summary: requested.includes('summary'),
			scp,
			scpMode: mode === 'graph' ? 'graph' : 'full'
		},
		valid: true
	};
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

async function getLatestLedger(
	config: NetworkLiveWebSocketConfig
): Promise<LiveLatestLedgerDTO> {
	const scannerLedger = await config.getLatestObservedLedger.execute();
	if (scannerLedger.isErr()) {
		config.logger?.error('Scanner-owned latest ledger unavailable', {
			error: errorMessage(scannerLedger.error)
		});
	} else if (scannerLedger.value !== null) {
		return scannerLedger.value;
	}

	const horizonLedger = await fetchLatestLedger(config.horizonUrl);
	const observedAt = new Date();
	const closedAtMs = Date.parse(horizonLedger.closedAt);
	const ageMs = observedAt.getTime() - closedAtMs;
	const freshnessMs = Number.isFinite(ageMs)
		? Math.abs(ageMs)
		: scpStatementObservationPolicy.readFreshnessMs + 1;
	return {
		...horizonLedger,
		freshness:
			ageMs >= -scpStatementObservationPolicy.readFutureToleranceMs &&
			ageMs <= scpStatementObservationPolicy.readFreshnessMs
				? 'fresh'
				: 'stale',
		freshnessMs,
		observedAt: observedAt.toISOString(),
		source: 'horizon_fallback'
	};
}

const ledgerSemanticKey = (ledger: LiveLatestLedgerDTO): string =>
	JSON.stringify([
		ledger.sequence,
		ledger.closedAt,
		ledger.protocolVersion,
		ledger.source,
		ledger.freshness
	]);

const summaryPayload = (network: NetworkV1) => ({
	name: network.name,
	time: network.time,
	latestLedger: network.latestLedger
});

const graphStatement = (statement: ScpStatementObservationV1) => ({
	nodeId: statement.nodeId,
	observedAt: statement.observedAt,
	observedFromPeer: statement.observedFromPeer,
	quorumSetHash: statement.pledges.quorumSetHash,
	slotIndex: statement.slotIndex,
	statementHash: statement.statementHash,
	statementType: statement.statementType,
	values: statement.values.map((value) => ({
		closeTime: value.closeTime,
		txSetHash: value.txSetHash,
		upgradeCount: value.upgradeCount,
		value: value.value
	}))
});

function rejectInvalidUpgrade(socket: Socket): void {
	socket.end(
		'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
	);
}

export function attachNetworkLiveWebSocket(
	server: Server,
	config: NetworkLiveWebSocketConfig
): void {
	const path = config.path ?? defaultPath;
	const clients = new Map<WebSocket, LiveClient>();
	const webSocketServer = new WebSocketServer({ maxPayload: 16_384, noServer: true });
	const scpLiveHub = getSharedScpStatementLiveHub(
		config.getScpStatements,
		config.logger
	);
	let latestLedgerTimer: ReturnType<typeof setInterval> | undefined;
	let networkTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let latestLedgerFailureCount = 0;
	let latestLedgerRetryAtMs = 0;
	let latestLedgerWriting = false;
	let networkWriting = false;
	let networkMessageSerialized: string | null = null;
	let summaryMessageSerialized: string | null = null;
	let ledgerMessageSerialized: string | null = null;
	let ledgerCacheSemanticKey: string | null = null;

	const send = (client: LiveClient, message: LiveMessage): boolean =>
		client.sender.send(JSON.stringify(message));

	const broadcastError = (message: string): void => {
		for (const client of clients.values()) {
			send(client, { payload: { message }, type: 'error' });
		}
	};

	const hasNetworkSubscribers = (): boolean =>
		[...clients.values()].some(
			({ channels }) => channels.network || channels.summary
		);

	const writeLatestLedger = (): void => {
		if (
			latestLedgerWriting ||
			Date.now() < latestLedgerRetryAtMs ||
			!hasNetworkSubscribers()
		) return;
		latestLedgerWriting = true;
		void getLatestLedger(config)
			.then((payload) => {
				latestLedgerFailureCount = 0;
				latestLedgerRetryAtMs = 0;
				const semanticKey = ledgerSemanticKey(payload);
				const changed = ledgerCacheSemanticKey !== semanticKey;
				ledgerCacheSemanticKey = semanticKey;
				const message = JSON.stringify({ payload, type: 'latestLedger' });
				ledgerMessageSerialized = message;
				if (!changed) return;
				for (const client of clients.values()) {
					if (client.channels.network || client.channels.summary) {
						client.sender.send(message);
					}
				}
			})
			.catch((error) => {
				latestLedgerFailureCount++;
				const retryDelayMs = Math.min(
					latestLedgerFailureInitialRetryMs *
						2 ** Math.min(latestLedgerFailureCount - 1, 10),
					latestLedgerFailureMaximumRetryMs
				);
				latestLedgerRetryAtMs = Date.now() + retryDelayMs;
				config.logger?.error('Live WebSocket latest ledger unavailable', {
					error: errorMessage(error)
				});
				broadcastError('Latest ledger unavailable');
			})
			.finally(() => {
				latestLedgerWriting = false;
			});
	};

	const writeNetwork = (): void => {
		if (networkWriting || !hasNetworkSubscribers()) return;
		networkWriting = true;
		void config.getNetwork
			.execute({})
			.then((networkOrError) => {
				if (networkOrError.isErr() || networkOrError.value === null) {
					broadcastError('Network snapshot unavailable');
					return;
				}
				const network = networkOrError.value;
				const summary = summaryPayload(network);
				const nextNetworkMessage = JSON.stringify({ payload: network, type: 'network' });
				const nextSummaryMessage = JSON.stringify({ payload: summary, type: 'summary' });
				const topologyChanged = networkMessageSerialized !== nextNetworkMessage;
				const summaryChanged = summaryMessageSerialized !== nextSummaryMessage;
				networkMessageSerialized = nextNetworkMessage;
				summaryMessageSerialized = nextSummaryMessage;
				if (!topologyChanged && !summaryChanged) return;
				for (const client of clients.values()) {
					if (client.channels.network && topologyChanged) {
						if (networkMessageSerialized !== null) client.sender.send(networkMessageSerialized);
					}
					if (client.channels.summary && summaryChanged) {
						if (summaryMessageSerialized !== null) client.sender.send(summaryMessageSerialized);
					}
				}
			})
			.catch((error) => {
				config.logger?.error('Live WebSocket network unavailable', {
					error: errorMessage(error)
				});
				broadcastError('Network snapshot unavailable');
			})
			.finally(() => {
				networkWriting = false;
			});
	};

	const start = (): void => {
		if (hasNetworkSubscribers()) {
			if (!networkTimer) {
				writeNetwork();
				networkTimer = setInterval(writeNetwork, networkIntervalMs);
			}
			if (!latestLedgerTimer) {
				writeLatestLedger();
				latestLedgerTimer = setInterval(writeLatestLedger, latestLedgerIntervalMs);
			}
		}
		if (!heartbeatTimer) heartbeatTimer = setInterval(() => {
			const message = JSON.stringify({
				payload: { observedAt: new Date().toISOString() },
				type: 'heartbeat'
			});
			for (const client of clients.values()) {
				client.sender.send(message);
			}
		}, heartbeatIntervalMs);
	};

	const stop = (): void => {
		if (!hasNetworkSubscribers()) {
			if (networkTimer) clearInterval(networkTimer);
			if (latestLedgerTimer) clearInterval(latestLedgerTimer);
			networkTimer = undefined;
			latestLedgerTimer = undefined;
		}
		if (clients.size === 0) {
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
	};

	const removeClient = (socket: WebSocket): void => {
		const client = clients.get(socket);
		if (client === undefined) return;
		clients.delete(socket);
		client.scpUnsubscribe();
		stop();
	};

	webSocketServer.on('connection', (socket, request) => {
		const resume = parseNetworkLiveResumeCursor(request.url);
		const subscription = parseNetworkLiveChannels(request.url);
		if (!resume.valid || !subscription.valid) {
			socket.close(1008, 'invalid subscription');
			return;
		}
		const client: LiveClient = {
			channels: subscription.channels,
			scpUnsubscribe: () => undefined,
			sender: new BoundedWebSocketSender(
				socket,
				() => removeClient(socket),
				config.logger
			)
		};
		clients.set(socket, client);
		socket.once('close', () => client.sender.markClosed());
		socket.on('error', (error) => {
			config.logger?.error('Live WebSocket client error', {
				error: errorMessage(error)
			});
			client.sender.close(1011, 'client error');
		});

		if (client.channels.scp) {
			const unsubscribe = scpLiveHub.subscribe(
				{
					onError: (message) =>
						send(client, { payload: { message }, type: 'error' }),
					onUpdate: ({ cursor, metadata, statements, truncated }) => {
						const payload =
							client.channels.scpMode === 'graph'
								? statements.map(graphStatement)
								: statements;
						const message = JSON.stringify({
							...metadata,
							cursor,
							payload,
							truncated,
							type:
								client.channels.scpMode === 'graph' ? 'scpGraph' : 'scp'
						} satisfies LiveMessage);
						if (!isWithinScpStatementTransportCeiling(message)) {
							config.logger?.warn('SCP WebSocket frame exceeds transport limit');
							return false;
						}
						return client.sender.send(message);
					}
				},
				resume.cursor
			);
			if (unsubscribe === null) {
				client.sender.close(1013, 'SCP live capacity');
				return;
			}
			client.scpUnsubscribe = unsubscribe;
		}

		if (client.channels.network || client.channels.summary) {
			if (client.channels.network && networkMessageSerialized !== null) {
				client.sender.send(networkMessageSerialized);
			}
			if (client.channels.summary && summaryMessageSerialized !== null) {
				client.sender.send(summaryMessageSerialized);
			}
			if (ledgerMessageSerialized !== null) {
				client.sender.send(ledgerMessageSerialized);
			}
		}
		start();
	});

	server.on(
		'upgrade',
		(request: IncomingMessage, socket: Socket, head: Buffer) => {
			if (!isWebSocketPath(request, path)) return;
			if (
				!parseNetworkLiveResumeCursor(request.url).valid ||
				!parseNetworkLiveChannels(request.url).valid
			) {
				rejectInvalidUpgrade(socket);
				return;
			}
			webSocketServer.handleUpgrade(request, socket, head, (client) => {
				webSocketServer.emit('connection', client, request);
			});
		}
	);

	server.on('close', () => {
		for (const client of clients.values()) client.sender.terminate();
		stop();
		webSocketServer.close();
	});
}
