import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import {
	createLiveUpdatesSession,
	type LiveUpdatesEnvironment
} from './live-updates-session';
import { contractEventExample } from '../../../blockchain/contract-event-query';
import {
	contractActivityPath,
	parseContractActivityPage
} from '../../../../api/explorer-contract-activity';
import { parseWarehousePublicationMessage } from '../../../../../../backend/src/status/infrastructure/http/WarehouseLiveWebSocket';

export const eventUrl =
	'https://api.stellaratlas.io' +
	contractActivityPath(
		contractEventExample.contract_id,
		'events',
		contractEventExample
	);
const minimum = Number(contractEventExample.min_ledger),
	maximum = Number(contractEventExample.max_ledger);
export function publication(id = 1) {
	const value = {
		version: 1,
		event: 'datasets.published',
		batchId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
		minLedger: minimum,
		maxLedger: maximum,
		publishedAt: '2026-11-02T12:00:00.123Z',
		datasets: ['history_contract_events']
	};
	assert.deepEqual(
		parseWarehousePublicationMessage(Buffer.from(JSON.stringify(value))),
		value
	);
	return value;
}
export const eventPage = {
	contractId: contractEventExample.contract_id,
	items: [],
	limit: 10,
	nextCursor: null,
	elapsedMilliseconds: 1,
	watermark: {
		minimumLedger: minimum,
		maximumLedger: maximum,
		observedAt: '2026-11-02T12:00:00.123Z',
		coverage: 'ingested-only'
	},
	coverage: {
		contiguousFirstLedger: String(minimum),
		contiguousLastLedger: String(maximum),
		contiguousLedgerCount: '64',
		supplementalLedgerCount: '0',
		totalLedgerCount: '64',
		nextLedger: String(maximum + 1),
		minimumLedger: String(minimum),
		maximumLedger: String(maximum),
		gapCount: 0
	}
};
// Validate the synthetic HTTP page with the actual consumer contract, not a handwritten schema.
parseContractActivityPage(
	eventPage,
	contractEventExample.contract_id,
	'events'
);

export async function until(
	check: () => boolean,
	label: string
): Promise<void> {
	const limit = Date.now() + 3000;
	while (!check()) {
		if (Date.now() > limit) throw new Error('Timed out: ' + label);
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
}
export const settle = (ms = 350): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

interface Output {
	readonly kind: 'log' | 'error' | 'info';
	readonly values: readonly unknown[];
}
interface Read {
	readonly url: string;
	readonly path: string;
	readonly method: string;
	readonly cookie: boolean;
	readonly authorization: boolean;
	aborted: boolean;
}
interface Controls {
	stop(): void;
	remembered(): number;
}

/** Real loopback adapters for the normally imported, whole-body-parity-bound typed session. */
export async function wireFixture() {
	const outputs: Output[] = [],
		reads: Read[] = [],
		frames: { session: number; data: unknown }[] = [];
	const clients: WebSocket[] = [],
		peers: WebSocket[] = [],
		messages: unknown[] = [],
		failures: unknown[] = [];
	const sessions: Controls[] = [],
		timers = new Set<ReturnType<typeof setTimeout>>(),
		held: ServerResponse[] = [];
	const timerHandles = new Map<number, ReturnType<typeof setTimeout>>();
	let nextTimerId = 0;
	let mode: 'success' | 'http' | 'body' | 'hold' | 'slow-body' = 'success';
	let active = 0,
		maximumActive = 0,
		upgrades = 0,
		pongs = 0,
		rejectUpgrade = false;
	const server = createServer((request, response) => {
		assert.equal(
			request.url,
			new URL(eventUrl).pathname + new URL(eventUrl).search
		);
		const read: Read = {
			url: eventUrl,
			path: request.url,
			method: request.method ?? '',
			cookie: !!request.headers.cookie,
			authorization: !!request.headers.authorization,
			aborted: false
		};
		reads.push(read);
		active++;
		maximumActive = Math.max(maximumActive, active);
		response.once('close', () => {
			active--;
			read.aborted = !response.writableEnded;
		});
		if (mode === 'hold') {
			held.push(response);
			return;
		}
		if (mode === 'slow-body') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.write('{"items":');
			held.push(response);
			return;
		}
		if (mode === 'http') {
			response.writeHead(503).end('Synthetic unavailable');
			return;
		}
		response
			.writeHead(200, { 'content-type': 'application/json' })
			.end(mode === 'body' ? '{bad' : JSON.stringify(eventPage));
	});
	const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
	server.on('upgrade', (request, socket, head) => {
		upgrades++;
		assert.equal(request.url, '/v1/stream/data');
		assert.equal(request.headers.origin, 'https://stellaratlas.io');
		if (rejectUpgrade) {
			socket.end(
				'HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
			);
			return;
		}
		if (wss.clients.size >= 2) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, (peer) =>
			wss.emit('connection', peer, request)
		);
	});
	wss.on('connection', (peer) => {
		peers.push(peer);
		peer.on('message', (data) => messages.push(data));
		peer.on('pong', () => pongs++);
		peer.send(JSON.stringify({ version: 1, event: 'ready' }));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string')
		throw Error('Missing loopback address');
	const port = address.port;
	const origin = 'http://127.0.0.1:' + port;
	const fetchLocal = (url: string, options?: { signal?: AbortSignal }) => {
		assert.equal(url, eventUrl);
		return fetch(origin + new URL(url).pathname + new URL(url).search, {
			signal: options?.signal,
			credentials: 'omit'
		});
	};
	function start(): Controls {
		const session = clients.length;
		class LocalSocket {
			onmessage?: (event: { data: unknown }) => void;
			onclose?: () => void;
			private readonly socket: WebSocket;
			constructor(url: string) {
				assert.equal(url, 'wss://api.stellaratlas.io/v1/stream/data');
				this.socket = new WebSocket(
					'ws://127.0.0.1:' + port + '/v1/stream/data',
					{ origin: 'https://stellaratlas.io' }
				);
				clients.push(this.socket);
				this.socket.on('message', (data, binary) => {
					const payload = binary ? data : data.toString();
					frames.push({ session, data: payload });
					this.onmessage?.({ data: payload });
				});
				this.socket.on('close', () => this.onclose?.());
				// Node's EventEmitter requires a listener; browser error events themselves do not throw.
				this.socket.on('error', (error) => failures.push(error));
			}
			close(): void {
				this.socket.close();
			}
		}
		const environment: LiveUpdatesEnvironment = {
			WebSocket: LocalSocket,
			setTimeout: (callback, delay) => {
				assert.ok([250, 10000].includes(delay));
				const id = ++nextTimerId;
				const timer = setTimeout(() => {
					timers.delete(timer);
					timerHandles.delete(id);
					void Promise.resolve(callback()).catch((error) =>
						failures.push(error)
					);
				}, delay);
				timers.add(timer);
				timerHandles.set(id, timer);
				return id;
			},
			clearTimeout: (id) => {
				const timer = timerHandles.get(id);
				if (timer === undefined) return;
				clearTimeout(timer);
				timers.delete(timer);
				timerHandles.delete(id);
			},
			fetch: fetchLocal,
			console: {
				log: (...values) => outputs.push({ kind: 'log', values }),
				error: (...values) => outputs.push({ kind: 'error', values }),
				info: (...values) => outputs.push({ kind: 'info', values })
			}
		};
		const controls: Controls = createLiveUpdatesSession(
			eventUrl,
			minimum,
			maximum,
			environment
		);
		sessions.push(controls);
		return controls;
	}
	const sendRaw = (data: string | Buffer) => {
		for (const peer of wss.clients)
			if (peer.readyState === WebSocket.OPEN) peer.send(data);
	};
	return {
		outputs,
		reads,
		frames,
		clients,
		peers,
		messages,
		failures,
		timers,
		start,
		setMode(value: typeof mode) {
			mode = value;
		},
		setRejectUpgrade() {
			rejectUpgrade = true;
		},
		send(value: unknown = publication()) {
			sendRaw(JSON.stringify(value));
		},
		sendRaw,
		ping() {
			for (const peer of wss.clients) peer.ping();
		},
		closeFeed() {
			for (const peer of wss.clients) peer.close(1013, 'backpressure');
		},
		release() {
			for (const response of held.splice(0))
				if (!response.destroyed)
					response
						.writeHead(200, { 'content-type': 'application/json' })
						.end(JSON.stringify(eventPage));
		},
		catchUp: () => fetchLocal(eventUrl),
		stats: () => ({ active, maximumActive, upgrades, pongs }),
		async close() {
			for (const session of sessions) session.stop();
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			timerHandles.clear();
			for (const client of clients) client.terminate();
			for (const peer of peers) peer.terminate();
			for (const response of held) response.destroy();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	};
}
