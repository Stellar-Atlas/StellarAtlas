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
import type {
	FullHistoryStatusDTO,
	GetFullHistoryStatus
} from '../../use-cases/get-full-history-status/GetFullHistoryStatus.js';
import type { GetScanLogStatus } from '../../use-cases/get-scan-log-status/GetScanLogStatus.js';
import type { GetWorkerStatus } from '../../use-cases/get-worker-status/GetWorkerStatus.js';
import type { ScanLogStatusDTO } from '../../use-cases/get-scan-log-status/GetScanLogStatus.js';
import type { WorkerStatusDTO } from '../../use-cases/get-worker-status/GetWorkerStatus.js';

export interface StatusLiveWebSocketConfig {
	readonly getApiStatus: GetApiStatus;
	readonly getDataQualityStatus: GetDataQualityStatus;
	readonly getFrontendStatus: GetFrontendStatus;
	readonly getFullHistoryStatus: GetFullHistoryStatus;
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
	readonly fullHistory: FullHistoryStatusDTO;
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

interface BoundedSingleFlightWriterConfig<T> {
	readonly collect: () => Promise<T>;
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
			const collection = Promise.resolve().then(config.collect);
			void collection
				.then((value) => {
					config.onValue(value);
				})
				.catch((error: unknown) => {
					config.onError(error);
				})
				.finally(() => {
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
		onError: (error) => {
			config.logger?.error('Status WebSocket archive events unavailable', {
				error: errorMessage(error)
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const archiveSummaryWriter = createBoundedSingleFlightWriter({
		collect: () => collectArchiveSummaryPatch(config),
		onError: (error) => {
			config.logger?.error('Status WebSocket archive summary unavailable', {
				error: errorMessage(error)
			});
		},
		onValue: (payload) => broadcast({ payload, type: 'status-patch' })
	});
	const scanLogWriter = createBoundedSingleFlightWriter({
		collect: () => collectScanLogPatch(config),
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
		readStatusField(
			'api',
			() => readResult(config.getApiStatus.execute()),
			config.logger
		),
		readStatusField(
			'dataQuality',
			() => readResult(config.getDataQualityStatus.execute()),
			config.logger
		),
		readStatusField(
			'frontend',
			() => readResult(config.getFrontendStatus.execute()),
			config.logger
		),
		readStatusField(
			'workers',
			() => readResult(config.getWorkerStatus.execute()),
			config.logger
		)
	]);

	const patch: StatusLivePatch = {
		generatedAt: new Date().toISOString(),
		...(api.available ? { api: api.value } : {}),
		...(dataQuality.available ? { dataQuality: dataQuality.value } : {}),
		...(frontend.available ? { frontend: frontend.value } : {}),
		...(workers.available ? { workers: workers.value } : {})
	};
	if (!hasStatusValues(patch)) {
		throw new Error('No fast status fields were available');
	}
	return patch;
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

export async function collectArchiveSummaryPatch(
	config: StatusLiveWebSocketConfig
): Promise<StatusLivePatch> {
	const [archiveSummary, fullHistory] = await Promise.all([
		readStatusField(
			'archiveSummary',
			() => readResult(config.getHistoryArchiveObjectSummary.execute()),
			config.logger
		),
		readStatusField(
			'fullHistory',
			() => readResult(config.getFullHistoryStatus.executeFullHistory()),
			config.logger
		)
	]);

	const patch: StatusLivePatch = {
		generatedAt: new Date().toISOString(),
		...(archiveSummary.available
			? { archiveSummary: archiveSummary.value }
			: {}),
		...(fullHistory.available ? { fullHistory: fullHistory.value } : {})
	};
	if (!hasStatusValues(patch)) {
		throw new Error('No archive status fields were available');
	}
	return patch;
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

type StatusFieldRead<T> =
	| { readonly available: false }
	| { readonly available: true; readonly value: T };

async function readStatusField<T>(
	field: keyof StatusLiveSnapshot,
	read: () => Promise<T>,
	logger: Logger | undefined
): Promise<StatusFieldRead<T>> {
	try {
		return { available: true, value: await read() };
	} catch (error) {
		logger?.warn('Status WebSocket field unavailable', {
			error: errorMessage(error),
			field
		});
		return { available: false };
	}
}

function hasStatusValues(patch: StatusLivePatch): boolean {
	return Object.keys(patch).some((field) => field !== 'generatedAt');
}

function isWebSocketPath(request: IncomingMessage, path: string): boolean {
	if (!request.url) return false;
	const url = new URL(request.url, 'http://127.0.0.1');
	return url.pathname === path;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
