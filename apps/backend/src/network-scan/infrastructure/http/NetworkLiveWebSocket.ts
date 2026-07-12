import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Logger } from '@core/services/Logger.js';
import { WebSocket, WebSocketServer } from 'ws';
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

interface NetworkLiveWebSocketConfig {
	getLatestObservedLedger: GetLatestObservedLedger;
	getNetwork: GetNetwork;
	getScpStatements: GetScpStatements;
	horizonUrl: string;
	logger?: Logger;
	path?: string;
}

type LiveMessage =
	| { payload: unknown; type: 'network' | 'latestLedger' }
	| {
			freshness: ScpStatementReadFreshness;
			freshnessMs: number | null;
			observedAt: string | null;
			payload: unknown;
			source: ScpStatementReadSource;
			type: 'scp';
	  }
	| { payload: { message: string }; type: 'error' };

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

interface LiveClient {
	scpUnsubscribe: () => void;
	sender: BoundedWebSocketSender;
}

const defaultPath = '/v1/live/ws';
const latestLedgerIntervalMs = 2_000;
const networkIntervalMs = 5_000;

const isWebSocketPath = (request: IncomingMessage, path: string): boolean => {
	if (!request.url) return false;
	const url = new URL(request.url, 'http://127.0.0.1');
	return url.pathname === path;
};

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

export function attachNetworkLiveWebSocket(
	server: Server,
	config: NetworkLiveWebSocketConfig
): void {
	const path = config.path ?? defaultPath;
	const clients = new Map<WebSocket, LiveClient>();
	const webSocketServer = new WebSocketServer({ noServer: true });
	const scpLiveHub = getSharedScpStatementLiveHub(
		config.getScpStatements,
		config.logger
	);
	let latestLedgerTimer: ReturnType<typeof setInterval> | undefined;
	let networkTimer: ReturnType<typeof setInterval> | undefined;
	let latestLedgerWriting = false;
	let networkWriting = false;

	const broadcast = (message: LiveMessage): void => {
		const payload = JSON.stringify(message);
		for (const client of clients.values()) client.sender.send(payload);
	};

	const writeLatestLedger = (): void => {
		if (latestLedgerWriting) return;
		latestLedgerWriting = true;
		void getLatestLedger(config)
			.then((payload) => broadcast({ payload, type: 'latestLedger' }))
			.catch((error) => {
				config.logger?.error('Live WebSocket latest ledger unavailable', {
					error: errorMessage(error)
				});
				broadcast({
					payload: { message: 'Latest ledger unavailable' },
					type: 'error'
				});
			})
			.finally(() => {
				latestLedgerWriting = false;
			});
	};

	const writeNetwork = (): void => {
		if (networkWriting) return;
		networkWriting = true;
		void config.getNetwork
			.execute({})
			.then((networkOrError) => {
				if (networkOrError.isErr() || networkOrError.value === null) {
					broadcast({
						payload: { message: 'Network snapshot unavailable' },
						type: 'error'
					});
					return;
				}
				broadcast({ payload: networkOrError.value, type: 'network' });
			})
			.catch((error) => {
				config.logger?.error('Live WebSocket network unavailable', {
					error: errorMessage(error)
				});
				broadcast({
					payload: { message: 'Network snapshot unavailable' },
					type: 'error'
				});
			})
			.finally(() => {
				networkWriting = false;
			});
	};

	const start = (): void => {
		if (networkTimer || latestLedgerTimer) return;
		writeNetwork();
		writeLatestLedger();
		networkTimer = setInterval(writeNetwork, networkIntervalMs);
		latestLedgerTimer = setInterval(writeLatestLedger, latestLedgerIntervalMs);
	};

	const stop = (): void => {
		if (clients.size > 0) return;
		if (networkTimer) clearInterval(networkTimer);
		if (latestLedgerTimer) clearInterval(latestLedgerTimer);
		networkTimer = undefined;
		latestLedgerTimer = undefined;
	};

	const removeClient = (socket: WebSocket): void => {
		const client = clients.get(socket);
		if (client === undefined) return;
		clients.delete(socket);
		client.scpUnsubscribe();
		stop();
	};

	webSocketServer.on('connection', (socket) => {
		const client: LiveClient = {
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
		const unsubscribe = scpLiveHub.subscribe({
			onError: (message) =>
				client.sender.send(
					JSON.stringify({
						payload: { message },
						type: 'error'
					} satisfies LiveMessage)
				),
			onUpdate: ({ metadata, statements }) =>
				client.sender.send(
					JSON.stringify({
						...metadata,
						payload: statements,
						type: 'scp'
					} satisfies LiveMessage)
				)
		});
		if (unsubscribe === null) {
			client.sender.close(1013, 'SCP live capacity');
			return;
		}
		client.scpUnsubscribe = unsubscribe;
		start();
	});

	server.on(
		'upgrade',
		(request: IncomingMessage, socket: Socket, head: Buffer) => {
			if (!isWebSocketPath(request, path)) return;
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
