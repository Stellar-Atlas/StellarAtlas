import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Logger } from '@core/services/Logger.js';
import { WebSocket, WebSocketServer } from 'ws';
import type { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../use-cases/get-scp-statements/GetScpStatements.js';
import type {
	GetLatestObservedLedger,
	LatestObservedLedgerDTO
} from '../../use-cases/get-latest-observed-ledger/GetLatestObservedLedger.js';
import { fetchLatestLedger } from './HorizonLedgerClient.js';
import {
	compareScpStatement,
	compareScpStatementCursor,
	createScpStatementStreamState,
	getScpStatementReadCursor,
	getScpStatementReadOrder,
	selectScpStatementDelta,
	type ScpStatementStreamState
} from './ScpStatementStreamState.js';

interface NetworkLiveWebSocketConfig {
	getLatestObservedLedger: GetLatestObservedLedger;
	getNetwork: GetNetwork;
	getScpStatements: GetScpStatements;
	horizonUrl: string;
	logger?: Logger;
	path?: string;
}

type LiveMessage =
	| { payload: unknown; type: 'network' | 'scp' | 'latestLedger' }
	| { payload: { message: string }; type: 'error' };

type LiveLatestLedgerDTO =
	| LatestObservedLedgerDTO
	| {
			readonly closedAt: string;
			readonly protocolVersion: number;
			readonly sequence: string;
			readonly source: 'horizon_fallback';
	  };

interface LiveClient {
	scpState: ScpStatementStreamState;
	socket: WebSocket;
}

const defaultPath = '/v1/live/ws';
const latestLedgerIntervalMs = 2_000;
const networkIntervalMs = 5_000;
const scpIntervalMs = 1_200;
const scpStatementLimit = 1_000;

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
	return {
		...horizonLedger,
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
	let latestLedgerTimer: ReturnType<typeof setInterval> | undefined;
	let networkTimer: ReturnType<typeof setInterval> | undefined;
	let scpTimer: ReturnType<typeof setInterval> | undefined;
	let latestLedgerWriting = false;
	let networkWriting = false;
	let scpWriting = false;

	const broadcast = (message: LiveMessage): void => {
		const payload = JSON.stringify(message);
		for (const client of clients.values()) {
			if (client.socket.readyState === WebSocket.OPEN)
				client.socket.send(payload);
		}
	};

	const send = (client: LiveClient, message: LiveMessage): void => {
		if (client.socket.readyState !== WebSocket.OPEN) return;
		client.socket.send(JSON.stringify(message));
	};

	const getOldestScpState = (): ScpStatementStreamState | undefined => {
		let oldestState: ScpStatementStreamState | null = null;
		for (const client of clients.values()) {
			if (client.scpState.cursor === null) return undefined;
			if (
				oldestState === null ||
				compareScpStatementCursor(client.scpState.cursor, oldestState.cursor!) <
					0
			) {
				oldestState = client.scpState;
			}
		}

		return oldestState ?? undefined;
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

	const writeScp = (): void => {
		if (scpWriting) return;
		scpWriting = true;
		const oldestState = getOldestScpState();
		// Sweep the live freshness window so late-visible statements are still deduped and delivered.
		void config.getScpStatements
			.execute({
				after: oldestState ? getScpStatementReadCursor(oldestState) : undefined,
				limit: scpStatementLimit,
				order: oldestState ? getScpStatementReadOrder(oldestState) : 'desc',
				source: 'live'
			})
			.then((statementsOrError) => {
				if (statementsOrError.isErr()) {
					broadcast({
						payload: { message: 'SCP statements unavailable' },
						type: 'error'
					});
					return;
				}
				const statements =
					statementsOrError.value.toSorted(compareScpStatement);
				for (const client of clients.values()) {
					const delta = selectScpStatementDelta(client.scpState, statements);
					if (delta.length > 0) send(client, { payload: delta, type: 'scp' });
				}
			})
			.catch((error) => {
				config.logger?.error('Live WebSocket SCP unavailable', {
					error: errorMessage(error)
				});
				broadcast({
					payload: { message: 'SCP statements unavailable' },
					type: 'error'
				});
			})
			.finally(() => {
				scpWriting = false;
			});
	};

	const start = (): void => {
		if (networkTimer || scpTimer || latestLedgerTimer) return;
		writeNetwork();
		writeScp();
		writeLatestLedger();
		networkTimer = setInterval(writeNetwork, networkIntervalMs);
		scpTimer = setInterval(writeScp, scpIntervalMs);
		latestLedgerTimer = setInterval(writeLatestLedger, latestLedgerIntervalMs);
	};

	const stop = (): void => {
		if (clients.size > 0) return;
		if (networkTimer) clearInterval(networkTimer);
		if (scpTimer) clearInterval(scpTimer);
		if (latestLedgerTimer) clearInterval(latestLedgerTimer);
		networkTimer = undefined;
		scpTimer = undefined;
		latestLedgerTimer = undefined;
	};

	webSocketServer.on('connection', (client) => {
		clients.set(client, {
			scpState: createScpStatementStreamState(),
			socket: client
		});
		client.on('close', () => {
			clients.delete(client);
			stop();
		});
		client.on('error', (error) => {
			config.logger?.error('Live WebSocket client error', {
				error: errorMessage(error)
			});
		});
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
		clients.clear();
		stop();
		webSocketServer.close();
	});
}
