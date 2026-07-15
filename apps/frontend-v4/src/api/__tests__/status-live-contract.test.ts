import {
	parseStatusLiveMessage,
	subscribeToStatusStream
} from '../status-live-stream';
import {
	createStatusLivePayload,
	generatedAt
} from './support/status-live-contract-fixtures';

describe('status WebSocket contract', () => {
	it('structurally parses every full snapshot field', () => {
		const message = parseStatusLiveMessage({
			payload: createStatusLivePayload(),
			type: 'status'
		});

		expect(message?.type).toBe('status');
		if (message?.type !== 'status') return;
		expect(message.payload.archiveSummary.sourceCount).toBe(1);
		expect(message.payload.workers.archiveWorkers).toMatchObject({
			activeWorkers: 20,
			freshWorkers: 20,
			telemetryMode: 'aggregate-only'
		});
		expect(
			message.payload.fullHistory.canonicalCoverage?.latestEvidence
		).toMatchObject({
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointProofId: 41,
			sourceObjects: {
				transactions: { contentDigest: '44'.repeat(32) }
			}
		});
		expect(message.payload.fullHistory.ledgerCloseMeta).toMatchObject({
			batchCount: 2,
			lastLedger: '130',
			nextLedger: '131'
		});
	});

	it('accepts a rolling-deploy snapshot without decoded history coverage', () => {
		const payload = createStatusLivePayload();
		const fullHistory = asRecord(payload.fullHistory);
		delete fullHistory.ledgerCloseMeta;

		const message = parseStatusLiveMessage({ payload, type: 'status' });
		expect(message?.type).toBe('status');
		if (message?.type !== 'status') return;
		expect(message.payload.fullHistory.ledgerCloseMeta).toBeNull();
	});

	it('rejects non-canonical source digests', () => {
		const payload = createStatusLivePayload();
		const fullHistory = asRecord(payload.fullHistory);
		const coverage = asRecord(fullHistory.canonicalCoverage);
		const evidence = asRecord(coverage.latestEvidence);
		const sourceObjects = asRecord(evidence.sourceObjects);
		const ledger = asRecord(sourceObjects.ledger);
		ledger.contentDigest = 'AA'.repeat(32);

		expect(parseStatusLiveMessage({ payload, type: 'status' })).toBeNull();
	});

	it('accepts the previous API contract without inventing provenance', () => {
		const payload = createStatusLivePayload();
		const fullHistory = asRecord(payload.fullHistory);
		const coverage = asRecord(fullHistory.canonicalCoverage);
		delete coverage.latestEvidence;

		const message = parseStatusLiveMessage({ payload, type: 'status' });
		expect(message?.type).toBe('status');
		if (message?.type !== 'status') return;
		expect(
			message.payload.fullHistory.canonicalCoverage?.latestEvidence
		).toBeNull();
	});

	it('rejects incoherent canonical coverage', () => {
		const payload = createStatusLivePayload();
		const fullHistory = asRecord(payload.fullHistory);
		const coverage = asRecord(fullHistory.canonicalCoverage);
		coverage.nextLedger = '63386369';

		expect(parseStatusLiveMessage({ payload, type: 'status' })).toBeNull();
	});

	it.each([
		[
			'generatedAt',
			(payload: Record<string, unknown>) => ({
				...payload,
				generatedAt: 'invalid'
			})
		],
		[
			'api',
			(payload: Record<string, unknown>) => ({
				...payload,
				api: { ...asRecord(payload.api), status: 'broken' }
			})
		],
		[
			'archiveEvents',
			(payload: Record<string, unknown>) => ({
				...payload,
				archiveEvents: { ...asRecord(payload.archiveEvents), events: [{}] }
			})
		],
		[
			'archiveSummary',
			(payload: Record<string, unknown>) => ({
				...payload,
				archiveSummary: {
					...asRecord(payload.archiveSummary),
					sourceCount: '1'
				}
			})
		],
		[
			'dataQuality',
			(payload: Record<string, unknown>) => ({
				...payload,
				dataQuality: {
					...asRecord(payload.dataQuality),
					archiveQueue: { activeJobs: -1 }
				}
			})
		],
		[
			'frontend',
			(payload: Record<string, unknown>) => ({
				...payload,
				frontend: { ...asRecord(payload.frontend), configured: 'yes' }
			})
		],
		[
			'fullHistory',
			(payload: Record<string, unknown>) => ({
				...payload,
				fullHistory: {
					...asRecord(payload.fullHistory),
					canonicalCoverage: { batchCount: -1 }
				}
			})
		],
		[
			'scanLogs',
			(payload: Record<string, unknown>) => ({
				...payload,
				scanLogs: { ...asRecord(payload.scanLogs), archiveScans: [{}] }
			})
		],
		[
			'workers',
			(payload: Record<string, unknown>) => ({
				...payload,
				workers: {
					...asRecord(payload.workers),
					archiveWorkers: { activeWorkers: '20' }
				}
			})
		]
	] as const)('rejects malformed %s patches', (_field, mutate) => {
		expect(
			parseStatusLiveMessage({
				payload: mutate(createStatusLivePayload()),
				type: 'status-patch'
			})
		).toBeNull();
	});

	it('rejects unknown patch fields', () => {
		expect(
			parseStatusLiveMessage({
				payload: { generatedAt, internalState: '/srv/private' },
				type: 'status-patch'
			})
		).toBeNull();
	});

	it('reconstructs every nested field without retaining unknown keys', () => {
		const payload = createStatusLivePayload();
		for (const [field, value] of Object.entries(payload)) {
			if (field !== 'generatedAt') addUnknownNestedKeys(value);
		}

		const message = parseStatusLiveMessage({
			payload,
			type: 'status'
		});

		expect(message?.type).toBe('status');
		expect(JSON.stringify(message)).not.toContain('__internalSecret');
		expect(JSON.stringify(message)).not.toContain('/srv/private/status');
	});

	it('ignores a superseded socket close without opening a duplicate', () => {
		const originalWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			'window'
		);
		const originalWebSocket = Object.getOwnPropertyDescriptor(
			globalThis,
			'WebSocket'
		);
		const sockets: FakeWebSocket[] = [];
		class TestWebSocket extends FakeWebSocket {
			constructor() {
				super();
				sockets.push(this);
			}
		}

		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {
				clearTimeout,
				location: { hostname: 'localhost', origin: 'http://localhost' },
				setTimeout
			}
		});
		Object.defineProperty(globalThis, 'WebSocket', {
			configurable: true,
			value: TestWebSocket
		});

		try {
			const unsubscribeFirst = subscribeToStatusStream(() => undefined);
			unsubscribeFirst();
			const unsubscribeSecond = subscribeToStatusStream(() => undefined);
			expect(sockets).toHaveLength(2);

			sockets[0]?.emit('close');
			const unsubscribeThird = subscribeToStatusStream(() => undefined);
			expect(sockets).toHaveLength(2);

			unsubscribeThird();
			unsubscribeSecond();
		} finally {
			restoreGlobal('window', originalWindow);
			restoreGlobal('WebSocket', originalWebSocket);
		}
	});
});

type FakeSocketListener = (event: { readonly data?: unknown }) => void;

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	readonly listeners = new Map<string, FakeSocketListener[]>();
	readyState = FakeWebSocket.CONNECTING;

	addEventListener(type: string, listener: FakeSocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	close(): void {
		this.readyState = 3;
	}

	emit(type: string, event: { readonly data?: unknown } = {}): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function restoreGlobal(
	name: 'WebSocket' | 'window',
	descriptor: PropertyDescriptor | undefined
): void {
	if (descriptor === undefined) {
		Reflect.deleteProperty(globalThis, name);
		return;
	}
	Object.defineProperty(globalThis, name, descriptor);
}

function addUnknownNestedKeys(value: unknown): void {
	if (Array.isArray(value)) {
		for (const entry of value) addUnknownNestedKeys(entry);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	const record = value as Record<string, unknown>;
	for (const entry of Object.values(record)) addUnknownNestedKeys(entry);
	record.__internalSecret = '/srv/private/status';
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: {};
}
