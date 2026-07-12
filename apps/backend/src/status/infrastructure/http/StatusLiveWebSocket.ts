import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import type { Result } from 'neverthrow';
import { WebSocket, WebSocketServer } from 'ws';
import type { Logger } from '@core/services/Logger.js';
import type { HistoryArchiveObjectEventsV1 } from 'shared';
import type { HistoryArchiveStatusSummaryV1 } from 'shared';
import type { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
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

export interface StatusLiveWebSocketConfig {
	readonly getApiStatus: GetApiStatus;
	readonly getDataQualityStatus: GetDataQualityStatus;
	readonly getFrontendStatus: GetFrontendStatus;
	readonly getHistoryArchiveObjectEvents: GetHistoryArchiveObjectEvents;
	readonly getHistoryArchiveObjectSummary: HistoryArchiveSummaryReader;
	readonly getScanLogStatus: GetScanLogStatus;
	readonly getWorkerStatus: GetWorkerStatus;
	readonly logger?: Logger;
	readonly path?: string;
}

interface HistoryArchiveSummaryReader {
	execute(): Promise<Result<HistoryArchiveStatusSummaryV1, Error>>;
}

interface StatusLiveSnapshot {
	readonly api: ApiStatusDTO;
	readonly archiveEvents: HistoryArchiveObjectEventsV1;
	readonly archiveSummary: HistoryArchiveStatusSummaryV1;
	readonly dataQuality: DataQualityStatusDTO;
	readonly frontend: ConfiguredServiceStatusDTO;
	readonly generatedAt: string;
	readonly scanLogs: ScanLogStatusDTO;
	readonly workers: WorkerStatusDTO;
}

type StatusLiveMessage =
	| { readonly payload: StatusLivePatch; readonly type: 'status-patch' }
	| { readonly payload: StatusLiveSnapshot; readonly type: 'status' }
	| { readonly payload: { readonly message: string }; readonly type: 'error' };

type StatusLivePatch = Partial<StatusLiveSnapshot> & {
	readonly generatedAt: string;
};

const defaultPath = '/v1/status/ws';
const statusIntervalMs = 2_500;
const archiveEventIntervalMs = 5_000;
const archiveSummaryIntervalMs = 30_000;
const scanLogIntervalMs = 30_000;
const archiveEventLimit = 100;
const scanLogLimit = 25;
const fastStatusDeadlineMs = 2_000;
const archiveEventDeadlineMs = 4_000;
const archiveSummaryDeadlineMs = 10_000;
const scanLogDeadlineMs = 10_000;

interface BoundedSingleFlightWriterConfig<T> {
	readonly collect: () => Promise<T>;
	readonly deadlineMs: number;
	readonly onError: (error: unknown) => void;
	readonly onValue: (value: T) => void;
}

export interface BoundedSingleFlightWriter {
	write(): boolean;
}

export function createBoundedSingleFlightWriter<T>(
	config: BoundedSingleFlightWriterConfig<T>
): BoundedSingleFlightWriter {
	let running = false;
	return {
		write(): boolean {
			if (running) return false;
			running = true;
			let deadlineReached = false;
			const collection = Promise.resolve().then(config.collect);
			const deadline = setTimeout(() => {
				deadlineReached = true;
				config.onError(
					new Error(`Status collection exceeded ${config.deadlineMs}ms`)
				);
			}, config.deadlineMs);
			void collection
				.then((value) => {
					if (!deadlineReached) config.onValue(value);
				})
				.catch((error: unknown) => {
					if (!deadlineReached) config.onError(error);
				})
				.finally(() => {
					clearTimeout(deadline);
					running = false;
				});
			return true;
		}
	};
}

export function attachStatusLiveWebSocket(
	server: Server,
	config: StatusLiveWebSocketConfig
): void {
	const path = config.path ?? defaultPath;
	const clients = new Set<WebSocket>();
	const webSocketServer = new WebSocketServer({ noServer: true });
	let archiveEventTimer: ReturnType<typeof setInterval> | undefined;
	let archiveSummaryTimer: ReturnType<typeof setInterval> | undefined;
	let fastTimer: ReturnType<typeof setInterval> | undefined;
	let scanLogTimer: ReturnType<typeof setInterval> | undefined;

	const broadcast = (message: StatusLiveMessage): void => {
		const payload = JSON.stringify(message);
		for (const client of clients) {
			if (client.readyState === WebSocket.OPEN) client.send(payload);
		}
	};

	const fastWriter = createBoundedSingleFlightWriter({
		collect: () => collectFastStatusPatch(config),
		deadlineMs: fastStatusDeadlineMs,
		onError: (error) => {
			config.logger?.error('Status WebSocket snapshot unavailable', {
				error: errorMessage(error)
			});
			broadcast({
				payload: { message: 'Status snapshot unavailable' },
				type: 'error'
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const archiveEventWriter = createBoundedSingleFlightWriter({
		collect: () => collectArchiveEventsPatch(config),
		deadlineMs: archiveEventDeadlineMs,
		onError: (error) => {
			config.logger?.error('Status WebSocket archive events unavailable', {
				error: errorMessage(error)
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const archiveSummaryWriter = createBoundedSingleFlightWriter({
		collect: () => collectArchiveSummaryPatch(config),
		deadlineMs: archiveSummaryDeadlineMs,
		onError: (error) => {
			config.logger?.error('Status WebSocket archive summary unavailable', {
				error: errorMessage(error)
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const scanLogWriter = createBoundedSingleFlightWriter({
		collect: () => collectScanLogPatch(config),
		deadlineMs: scanLogDeadlineMs,
		onError: (error) => {
			config.logger?.error('Status WebSocket scan logs unavailable', {
				error: errorMessage(error)
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const writeFastStatus = (): void => void fastWriter.write();
	const writeArchiveEvents = (): void => void archiveEventWriter.write();
	const writeArchiveSummary = (): void => void archiveSummaryWriter.write();
	const writeScanLogs = (): void => void scanLogWriter.write();

	const start = (): void => {
		if (
			fastTimer !== undefined ||
			archiveEventTimer !== undefined ||
			archiveSummaryTimer !== undefined ||
			scanLogTimer !== undefined
		) {
			return;
		}
		writeFastStatus();
		writeArchiveEvents();
		writeArchiveSummary();
		writeScanLogs();
		fastTimer = setInterval(writeFastStatus, statusIntervalMs);
		archiveEventTimer = setInterval(writeArchiveEvents, archiveEventIntervalMs);
		archiveSummaryTimer = setInterval(
			writeArchiveSummary,
			archiveSummaryIntervalMs
		);
		scanLogTimer = setInterval(writeScanLogs, scanLogIntervalMs);
	};

	const stop = (): void => {
		if (clients.size > 0) return;
		if (archiveEventTimer !== undefined) clearInterval(archiveEventTimer);
		if (archiveSummaryTimer !== undefined) clearInterval(archiveSummaryTimer);
		if (fastTimer !== undefined) clearInterval(fastTimer);
		if (scanLogTimer !== undefined) clearInterval(scanLogTimer);
		archiveEventTimer = undefined;
		archiveSummaryTimer = undefined;
		fastTimer = undefined;
		scanLogTimer = undefined;
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

export async function collectFastStatusPatch(
	config: StatusLiveWebSocketConfig
): Promise<StatusLivePatch> {
	const [api, dataQuality, frontend, workers] = await Promise.all([
		readResult(config.getApiStatus.execute()),
		readResult(config.getDataQualityStatus.execute()),
		readResult(config.getFrontendStatus.execute()),
		readResult(config.getWorkerStatus.execute())
	]);

	return {
		api,
		dataQuality,
		frontend,
		generatedAt: new Date().toISOString(),
		workers
	};
}

export async function collectScanLogPatch(
	config: StatusLiveWebSocketConfig
): Promise<StatusLivePatch> {
	const scanLogs = await readResult(
		config.getScanLogStatus.execute(scanLogLimit)
	);
	return { generatedAt: new Date().toISOString(), scanLogs };
}

async function collectArchiveEventsPatch(
	config: StatusLiveWebSocketConfig
): Promise<StatusLivePatch> {
	const archiveEvents = await readResult(
		config.getHistoryArchiveObjectEvents.execute({ limit: archiveEventLimit })
	);

	return {
		archiveEvents: stripArchiveEventFacts(archiveEvents),
		generatedAt: new Date().toISOString()
	};
}

async function collectArchiveSummaryPatch(
	config: StatusLiveWebSocketConfig
): Promise<StatusLivePatch> {
	const archiveSummary = await readResult(
		config.getHistoryArchiveObjectSummary.execute()
	);

	return {
		archiveSummary,
		generatedAt: new Date().toISOString()
	};
}

function stripArchiveEventFacts(
	events: HistoryArchiveObjectEventsV1
): HistoryArchiveObjectEventsV1 {
	return {
		...events,
		events: events.events.map((event) =>
			event.verificationFacts === null
				? event
				: { ...event, verificationFacts: null }
		)
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
