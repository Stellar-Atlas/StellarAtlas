import type { IncomingMessage, Server } from 'http';
import { readFile } from 'node:fs/promises';
import type { Duplex } from 'stream';
import { parse as parseDotenv } from 'dotenv';
import { connect, type NatsConnection, type Subscription } from 'nats';
import { WebSocket, WebSocketServer } from 'ws';

const subject = 'stellaratlas.warehouse.published';
const path = '/v1/stream/data';
const maximumPayload = 4_096;
const maximumBufferedBytes = 65_536;
const maximumClients = 1_000;
const heartbeatMs = 30_000;
const defaultNatsConfigFile = '/etc/stellaratlas/nats-warehouse.env';
const batchIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datasetPattern = /^[a-z][a-z0-9_]{0,63}$/;

export interface WarehousePublicationEvent {
	readonly version: 1;
	readonly event: 'datasets.published';
	readonly batchId: string;
	readonly minLedger: number;
	readonly maxLedger: number;
	readonly publishedAt: string;
	readonly datasets: readonly string[];
}

interface LiveClient extends WebSocket {
	isAlive: boolean;
}

export function parseWarehousePublicationMessage(
	data: Uint8Array
): WarehousePublicationEvent | null {
	if (data.byteLength === 0 || data.byteLength > maximumPayload) return null;
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(data).toString('utf8')) as unknown;
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	const event = value as Record<string, unknown>;
	if (
		event.version !== 1 ||
		event.event !== 'datasets.published' ||
		typeof event.batchId !== 'string' ||
		!batchIdPattern.test(event.batchId) ||
		!isLedger(event.minLedger) ||
		!isLedger(event.maxLedger) ||
		event.maxLedger < event.minLedger ||
		typeof event.publishedAt !== 'string' ||
		event.publishedAt.length > 40 ||
		!Number.isFinite(Date.parse(event.publishedAt)) ||
		!Array.isArray(event.datasets) ||
		event.datasets.length > 32 ||
		!event.datasets.every(
			(dataset) => typeof dataset === 'string' && datasetPattern.test(dataset)
		)
	)
		return null;
	return {
		version: 1,
		event: 'datasets.published',
		batchId: event.batchId,
		minLedger: event.minLedger,
		maxLedger: event.maxLedger,
		publishedAt: event.publishedAt,
		datasets: event.datasets as string[]
	};
}

function isLedger(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= 0xffff_ffff
	);
}

function isAllowedOrigin(origin: string | undefined): boolean {
	if (origin === undefined) return false;
	try {
		const parsed = new URL(origin);
		return (
			parsed.protocol === 'https:' && parsed.hostname === 'stellaratlas.io'
		);
	} catch {
		return false;
	}
}

function matchesPath(request: IncomingMessage): boolean {
	try {
		return new URL(request.url ?? '/', 'http://localhost').pathname === path;
	} catch {
		return false;
	}
}

export interface WarehouseNatsSettings {
	readonly servers: readonly string[];
	readonly token?: string;
}

export function resolveWarehouseNatsSettings(
	environment: NodeJS.ProcessEnv,
	configContents?: string
): WarehouseNatsSettings {
	const fileSettings =
		configContents === undefined ? {} : parseDotenv(configContents);
	const configuredServers =
		environment.WAREHOUSE_NATS_URL?.trim() ||
		environment.NATS_SERVERS?.trim() ||
		fileSettings.WAREHOUSE_NATS_URL?.trim() ||
		fileSettings.NATS_SERVERS?.trim();
	if (!configuredServers && configContents !== undefined)
		throw new Error('warehouse NATS endpoint is not configured');
	const servers = (configuredServers ?? 'nats://127.0.0.1:4222')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (servers.length === 0)
		throw new Error('warehouse NATS endpoint is not configured');
	const token =
		environment.NATS_TOKEN?.trim() || fileSettings.NATS_TOKEN?.trim();
	return token === undefined || token.length === 0
		? { servers }
		: { servers, token };
}

let lastNatsConfigWarningAt = 0;

function warnNatsConfigUnavailable(): void {
	const now = Date.now();
	if (now - lastNatsConfigWarningAt < 30_000) return;
	lastNatsConfigWarningAt = now;
	console.warn('Warehouse NATS configuration unavailable; retrying.');
}

async function loadWarehouseNatsSettings(): Promise<WarehouseNatsSettings> {
	const configPath =
		process.env.WAREHOUSE_NATS_CONFIG_FILE?.trim() || defaultNatsConfigFile;
	let configContents: string | undefined;
	try {
		configContents = await readFile(configPath, 'utf8');
	} catch (error) {
		if (
			typeof error !== 'object' ||
			error === null ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		) {
			warnNatsConfigUnavailable();
			throw new Error('warehouse NATS configuration is unavailable');
		}
	}
	try {
		return resolveWarehouseNatsSettings(process.env, configContents);
	} catch {
		warnNatsConfigUnavailable();
		throw new Error('warehouse NATS configuration is unavailable');
	}
}

function rejectUpgrade(
	socket: Duplex,
	status: 403 | 429,
	message: string
): void {
	socket.end(
		`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Too Many Requests'}\r\n` +
			'Connection: close\r\n' +
			`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
	);
}

export function attachWarehouseLiveWebSocket(server: Server): void {
	const clients = new Set<LiveClient>();
	const pendingSockets = new Set<Duplex>();
	const webSocketServer = new WebSocketServer({
		noServer: true,
		maxPayload: maximumPayload
	});
	let stopped = false;
	let connection: NatsConnection | undefined;
	let subscription: Subscription | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let finishRetry: (() => void) | undefined;

	const send = (client: LiveClient, payload: string): boolean => {
		if (client.readyState !== WebSocket.OPEN) return false;
		const bytes = Buffer.byteLength(payload);
		if (
			bytes > maximumBufferedBytes ||
			client.bufferedAmount + bytes > maximumBufferedBytes
		) {
			client.close(1013, 'backpressure');
			return false;
		}
		try {
			client.send(payload);
			return true;
		} catch {
			client.terminate();
			return false;
		}
	};

	const broadcast = (event: WarehousePublicationEvent): void => {
		const payload = JSON.stringify(event);
		for (const client of clients) send(client, payload);
	};

	webSocketServer.on('connection', (socket) => {
		const client = socket as LiveClient;
		client.isAlive = true;
		clients.add(client);
		client.on('pong', () => {
			client.isAlive = true;
		});
		client.on('close', () => {
			clients.delete(client);
		});
		client.on('error', () => {
			clients.delete(client);
		});
		send(client, JSON.stringify({ version: 1, event: 'ready' }));
		if (heartbeat === undefined) {
			heartbeat = setInterval(() => {
				for (const item of clients) {
					if (!item.isAlive) {
						item.terminate();
						clients.delete(item);
						continue;
					}
					item.isAlive = false;
					item.ping();
				}
			}, heartbeatMs);
			heartbeat.unref();
		}
	});

	server.on('upgrade', (request, socket, head) => {
		if (!matchesPath(request)) return;
		if (!isAllowedOrigin(request.headers.origin)) {
			rejectUpgrade(socket, 403, 'origin not allowed');
			return;
		}
		if (clients.size + pendingSockets.size >= maximumClients) {
			rejectUpgrade(socket, 429, 'connection limit reached');
			return;
		}
		pendingSockets.add(socket);
		socket.once('close', () => pendingSockets.delete(socket));
		webSocketServer.handleUpgrade(request, socket, head, (client) => {
			pendingSockets.delete(socket);
			webSocketServer.emit('connection', client, request);
		});
	});

	const consume = async (): Promise<void> => {
		let backoff = 1_000;
		while (!stopped) {
			try {
				const settings = await loadWarehouseNatsSettings();
				connection = await connect({
					name: 'stellaratlas-warehouse-live-websocket',
					servers: [...settings.servers],
					timeout: 2_000,
					maxReconnectAttempts: 10,
					reconnectTimeWait: 1_000,
					...(settings.token === undefined ? {} : { token: settings.token })
				});
				subscription = connection.subscribe(subject);
				const current = connection;
				void (async () => {
					for await (const message of subscription!) {
						const event = parseWarehousePublicationMessage(message.data);
						if (event !== null) broadcast(event);
					}
				})().catch(() => undefined);
				await current.closed();
			} catch {
				// Notifications are freshness hints; reconnect without affecting the API.
			} finally {
				subscription?.unsubscribe();
				subscription = undefined;
				connection?.close();
				connection = undefined;
			}
			if (stopped) break;
			await new Promise<void>((resolve) => {
				finishRetry = resolve;
				retryTimer = setTimeout(() => {
					retryTimer = undefined;
					finishRetry = undefined;
					resolve();
				}, backoff);
				retryTimer.unref();
			});
			backoff = Math.min(backoff * 2, 30_000);
		}
	};
	void consume();

	server.on('close', () => {
		stopped = true;
		if (retryTimer !== undefined) clearTimeout(retryTimer);
		finishRetry?.();
		if (heartbeat !== undefined) clearInterval(heartbeat);
		for (const client of clients) client.terminate();
		clients.clear();
		pendingSockets.clear();
		subscription?.unsubscribe();
		connection?.close();
		webSocketServer.close();
	});
}
