import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Logger } from '@core/services/Logger.js';
import { WebSocket, WebSocketServer } from 'ws';
import type { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import type { GetScpStatements } from '../../use-cases/get-scp-statements/GetScpStatements.js';
import { fetchLatestLedger } from './HorizonLedgerClient.js';
import type { ScpStatementObservationV1 } from 'shared';

interface NetworkLiveWebSocketConfig {
	getNetwork: GetNetwork;
	getScpStatements: GetScpStatements;
	horizonUrl: string;
	logger?: Logger;
	path?: string;
}

type LiveMessage =
	| { payload: unknown; type: 'network' | 'scp' | 'latestLedger' }
	| { payload: { message: string }; type: 'error' };

interface LiveClient {
	scpCursor: ScpCursor | null;
	seenScpStatementHashes: Set<string>;
	seenScpStatementHashQueue: string[];
	socket: WebSocket;
}

interface ScpCursor {
	observedAtMs: number;
	statementHash: string;
}

const defaultPath = '/v1/live/ws';
const latestLedgerIntervalMs = 2_000;
const networkIntervalMs = 5_000;
const scpIntervalMs = 1_200;
const scpStatementLimit = 1_000;
const maxSeenStatementHashes = 2_000;

const isWebSocketPath = (request: IncomingMessage, path: string): boolean => {
	if (!request.url) return false;
	const url = new URL(request.url, 'http://127.0.0.1');
	return url.pathname === path;
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const toScpCursor = (
	statement: ScpStatementObservationV1
): ScpCursor | null => {
	const observedAtMs = new Date(statement.observedAt).getTime();
	if (!Number.isFinite(observedAtMs)) return null;
	return { observedAtMs, statementHash: statement.statementHash };
};

const compareScpCursor = (left: ScpCursor, right: ScpCursor): number =>
	left.observedAtMs - right.observedAtMs ||
	left.statementHash.localeCompare(right.statementHash);

const compareScpStatement = (
	left: ScpStatementObservationV1,
	right: ScpStatementObservationV1
): number => {
	const leftCursor = toScpCursor(left);
	const rightCursor = toScpCursor(right);
	if (leftCursor === null && rightCursor === null) return 0;
	if (leftCursor === null) return 1;
	if (rightCursor === null) return -1;
	return compareScpCursor(leftCursor, rightCursor);
};

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

	const rememberScpStatementHash = (
		client: LiveClient,
		statementHash: string
	): void => {
		client.seenScpStatementHashes.add(statementHash);
		client.seenScpStatementHashQueue.push(statementHash);
		while (client.seenScpStatementHashQueue.length > maxSeenStatementHashes) {
			const evictedHash = client.seenScpStatementHashQueue.shift();
			if (evictedHash !== undefined) {
				client.seenScpStatementHashes.delete(evictedHash);
			}
		}
	};

	const selectScpDelta = (
		client: LiveClient,
		statements: readonly ScpStatementObservationV1[]
	): ScpStatementObservationV1[] => {
		const delta: ScpStatementObservationV1[] = [];
		for (const statement of statements) {
			const cursor = toScpCursor(statement);
			if (cursor === null) continue;
			if (client.seenScpStatementHashes.has(statement.statementHash)) {
				continue;
			}
			delta.push(statement);
			rememberScpStatementHash(client, statement.statementHash);
			if (
				client.scpCursor === null ||
				compareScpCursor(client.scpCursor, cursor) < 0
			) {
				client.scpCursor = cursor;
			}
		}
		return delta;
	};

	const getOldestScpCursor = (): ScpCursor | undefined => {
		let oldestCursor: ScpCursor | null = null;
		for (const client of clients.values()) {
			if (client.scpCursor === null) return undefined;
			if (
				oldestCursor === null ||
				compareScpCursor(client.scpCursor, oldestCursor) < 0
			) {
				oldestCursor = client.scpCursor;
			}
		}

		return oldestCursor ?? undefined;
	};

	const writeLatestLedger = (): void => {
		if (latestLedgerWriting) return;
		latestLedgerWriting = true;
		void fetchLatestLedger(config.horizonUrl)
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
		// Sweep the live freshness window so late-visible statements are still deduped and delivered.
		void config.getScpStatements
			.execute({
				after: getOldestScpCursor(),
				limit: scpStatementLimit,
				order: 'asc',
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
					const delta = selectScpDelta(client, statements);
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
			scpCursor: null,
			seenScpStatementHashes: new Set(),
			seenScpStatementHashQueue: [],
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
