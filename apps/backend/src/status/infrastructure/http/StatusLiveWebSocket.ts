import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Result } from 'neverthrow';
import { WebSocket, WebSocketServer } from 'ws';
import type { Logger } from '@core/services/Logger.js';
import type { HistoryArchiveObjectEventsV1 } from 'shared';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';
import type { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import type { GetHistoryArchiveObjectSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import type { ApiStatusDTO } from '../../domain/StatusTypes.js';
import type { ConfiguredServiceStatusDTO } from '../../use-cases/get-service-status/GetServiceStatus.js';
import type { DataQualityStatusDTO } from '../../use-cases/get-data-quality-status/GetDataQualityStatus.js';
import type { GetApiStatus } from '../../use-cases/get-api-status/GetApiStatus.js';
import type { GetDataQualityStatus } from '../../use-cases/get-data-quality-status/GetDataQualityStatus.js';
import type { GetFrontendStatus } from '../../use-cases/get-service-status/GetServiceStatus.js';
import type { GetScanLogStatus } from '../../use-cases/get-scan-log-status/GetScanLogStatus.js';
import type { GetWorkerStatus } from '../../use-cases/get-worker-status/GetWorkerStatus.js';
import type { ScanLogStatusDTO } from '../../use-cases/get-scan-log-status/GetScanLogStatus.js';
import type { WorkerStatusDTO } from '../../use-cases/get-worker-status/GetWorkerStatus.js';

interface StatusLiveWebSocketConfig {
	readonly getApiStatus: GetApiStatus;
	readonly getDataQualityStatus: GetDataQualityStatus;
	readonly getFrontendStatus: GetFrontendStatus;
	readonly getHistoryArchiveObjectEvents: GetHistoryArchiveObjectEvents;
	readonly getHistoryArchiveObjectSummary: GetHistoryArchiveObjectSummary;
	readonly getScanLogStatus: GetScanLogStatus;
	readonly getWorkerStatus: GetWorkerStatus;
	readonly logger?: Logger;
	readonly path?: string;
}

interface StatusLiveSnapshot {
	readonly api: ApiStatusDTO;
	readonly archiveEvents: HistoryArchiveObjectEventsV1;
	readonly archiveSummary: HistoryArchiveObjectSummaryV1;
	readonly dataQuality: DataQualityStatusDTO;
	readonly frontend: ConfiguredServiceStatusDTO;
	readonly generatedAt: string;
	readonly scanLogs: ScanLogStatusDTO;
	readonly workers: WorkerStatusDTO;
}

type StatusLiveMessage =
	| { readonly payload: StatusLiveSnapshot; readonly type: 'status' }
	| { readonly payload: { readonly message: string }; readonly type: 'error' };

const defaultPath = '/v1/status/ws';
const statusIntervalMs = 2_500;
const archiveEventLimit = 250;
const scanLogLimit = 25;

export function attachStatusLiveWebSocket(
	server: Server,
	config: StatusLiveWebSocketConfig
): void {
	const path = config.path ?? defaultPath;
	const clients = new Set<WebSocket>();
	const webSocketServer = new WebSocketServer({ noServer: true });
	let timer: ReturnType<typeof setInterval> | undefined;
	let writing = false;

	const broadcast = (message: StatusLiveMessage): void => {
		const payload = JSON.stringify(message);
		for (const client of clients) {
			if (client.readyState === WebSocket.OPEN) client.send(payload);
		}
	};

	const writeStatus = (): void => {
		if (writing) return;
		writing = true;
		void collectStatusLiveSnapshot(config)
			.then((payload) => broadcast({ payload, type: 'status' }))
			.catch((error) => {
				config.logger?.error('Status WebSocket snapshot unavailable', {
					error: errorMessage(error)
				});
				broadcast({
					payload: { message: 'Status snapshot unavailable' },
					type: 'error'
				});
			})
			.finally(() => {
				writing = false;
			});
	};

	const start = (): void => {
		if (timer !== undefined) return;
		writeStatus();
		timer = setInterval(writeStatus, statusIntervalMs);
	};

	const stop = (): void => {
		if (clients.size > 0 || timer === undefined) return;
		clearInterval(timer);
		timer = undefined;
	};

	webSocketServer.on('connection', (client) => {
		clients.add(client);
		client.on('close', () => {
			clients.delete(client);
			stop();
		});
		client.on('error', (error) => {
			config.logger?.error('Status WebSocket client error', {
				error: errorMessage(error)
			});
		});
		start();
	});

	server.on('upgrade', (request: IncomingMessage, socket: Socket, head) => {
		if (!isWebSocketPath(request, path)) return;
		webSocketServer.handleUpgrade(request, socket, head, (client) => {
			webSocketServer.emit('connection', client, request);
		});
	});

	server.on('close', () => {
		clients.clear();
		stop();
		webSocketServer.close();
	});
}

async function collectStatusLiveSnapshot(
	config: StatusLiveWebSocketConfig
): Promise<StatusLiveSnapshot> {
	const [
		api,
		dataQuality,
		frontend,
		archiveEvents,
		archiveSummary,
		scanLogs,
		workers
	] = await Promise.all([
		readResult(config.getApiStatus.execute()),
		readResult(config.getDataQualityStatus.execute()),
		readResult(config.getFrontendStatus.execute()),
		readResult(
			config.getHistoryArchiveObjectEvents.execute({ limit: archiveEventLimit })
		),
		readResult(config.getHistoryArchiveObjectSummary.execute()),
		readResult(config.getScanLogStatus.execute(scanLogLimit)),
		readResult(config.getWorkerStatus.execute())
	]);

	return {
		api,
		archiveEvents,
		archiveSummary,
		dataQuality,
		frontend,
		generatedAt: new Date().toISOString(),
		scanLogs,
		workers
	};
}

async function readResult<T>(
	result: Result<T, Error> | Promise<Result<T, Error>>
): Promise<T> {
	const resolved = await result;
	if (resolved.isErr()) throw resolved.error;
	return resolved.value;
}

function isWebSocketPath(request: IncomingMessage, path: string): boolean {
	if (!request.url) return false;
	const url = new URL(request.url, 'http://127.0.0.1');
	return url.pathname === path;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
