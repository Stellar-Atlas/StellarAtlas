import {
	parseStatusLiveMessage,
	subscribeToStatusStream
} from '../status-live-stream';

const generatedAt = '2026-07-10T12:10:00.000Z';

describe('status WebSocket contract', () => {
	it('structurally parses every full snapshot field', () => {
		const message = parseStatusLiveMessage({
			payload: createPayload(),
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
				payload: mutate(createPayload()),
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
		const payload = createPayload();
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

function createPayload(): Record<string, unknown> {
	return {
		api: { generatedAt, service: 'api', status: 'ok' },
		archiveEvents: {
			count: 1,
			events: [
				{
					archiveUrl: 'https://archive.example',
					archiveUrlIdentity: 'https://archive.example',
					bucketHash: null,
					bytesDownloaded: 1024,
					checkpointLedger: 63,
					claimAttempt: 1,
					createdAt: generatedAt,
					error: null,
					eventType: 'verified',
					evidenceClass: null,
					nextAttemptAt: null,
					objectKey: 'ledger:0000003f',
					objectRemoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
					objectType: 'ledger',
					objectUrl: 'https://archive.example/ledger/file.xdr.gz',
					remoteId: '93a309de-a5df-457b-9412-f267ed5e7388',
					verificationFacts: null,
					workerStage: 'verified_ledger'
				}
			],
			generatedAt,
			limit: 100
		},
		archiveSummary: createArchiveSummary(),
		dataQuality: createDataQuality(),
		frontend: {
			configured: true,
			configurationState: 'configured',
			generatedAt,
			health: 'not_probed',
			probe: 'not_run',
			readiness: 'configured_not_probed',
			requiredForProduction: true,
			service: 'frontend',
			status: 'ok',
			url: 'https://stellaratlas.example'
		},
		generatedAt,
		scanLogs: createScanLogs(),
		workers: createLegacyWorkers()
	};
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

function createArchiveSummary() {
	return {
		activeObjectChecks: 20,
		archiveEvidenceFailures: 1,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 1,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 9,
			completeArchiveCheckpoints: 9,
			discoveryCompleteArchiveRoots: 1,
			expectedArchiveCheckpoints: 10,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: 639,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 9,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 10
		},
		generatedAt,
		sourceCount: 1,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [
			{
				activeObjectChecks: 20,
				archiveEvidenceFailures: 1,
				archiveUrl: 'https://archive.example',
				archiveUrlIdentity: 'https://archive.example',
				currentLedger: 639,
				latestCheckpointLedger: 639,
				latestDiscoveredCheckpointLedger: 639,
				mismatchCheckpointProofs: 0,
				notEvaluableCheckpointProofs: 0,
				objectCompleteCheckpointProofs: 9,
				observedAt: generatedAt,
				pendingCheckpointProofs: 1,
				rootObjectStatus: 'verified',
				rootFailureChannel: null,
				scannerIssueFailures: 0,
				source: 'network-scan',
				stateStatus: 'available',
				stateUrl: 'https://archive.example/.well-known/stellar-history.json',
				totalCheckpointProofs: 10,
				unclassifiedFailures: 0,
				verifiedCheckpointProofs: 9
			}
		],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}

function createDataQuality() {
	const archiveEvidence = {
		ageMs: 1000,
		drivesPlatformStatus: false,
		drivesRuntimeHealth: false,
		latestAt: generatedAt,
		source: 'archive_object_evidence',
		staleAfterMs: 21_600_000,
		status: 'ok'
	};
	return {
		archiveQueue: {
			activeJobs: 20,
			generatedAt,
			pendingJobs: 100,
			staleJobAgeMs: 120_000,
			staleJobs: 0,
			status: 'ok',
			totalUnfinishedJobs: 120
		},
		dataFreshness: {
			archiveEvidence,
			archiveScan: {
				ageMs: 345_600_000,
				deprecated: true,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				historical: true,
				latestAt: '2026-07-06T12:10:00.000Z',
				source: 'legacy_range_scan',
				staleAfterMs: 21_600_000,
				status: 'degraded'
			},
			generatedAt,
			networkScan: {
				ageMs: 1000,
				latestAt: generatedAt,
				staleAfterMs: 600_000,
				status: 'ok'
			},
			status: 'ok'
		},
		generatedAt,
		rollups: {
			generatedAt,
			networkRollups: {
				daysWithCompletedScans: 1,
				daysWithRollups: 1,
				latestRollupDay: generatedAt,
				matchingDays: 1,
				mismatchedRollupDays: 0,
				missingRollupDays: 0,
				rawCompletedScans: 1,
				rollupCrawlCount: 1,
				status: 'ok',
				windowDays: 7,
				windowEnd: generatedAt,
				windowStart: generatedAt
			},
			status: 'ok'
		},
		scans: {
			generatedAt,
			networkScan: {
				completedScans: 1,
				completionRate: 100,
				expectedCompletionRate: 100,
				expectedScans: 1,
				incompleteScans: 0,
				latestCompletedScanAt: generatedAt,
				latestScanAt: generatedAt,
				scanIntervalMs: 180_000,
				status: 'ok',
				totalScans: 1,
				windowEnd: generatedAt,
				windowMs: 86_400_000,
				windowStart: generatedAt
			},
			status: 'ok'
		},
		status: 'ok'
	};
}

function createScanLogs() {
	return {
		archiveScans: [
			{
				concurrency: 1,
				durationMs: 1000,
				endDate: generatedAt,
				errorCount: 0,
				errors: [],
				fromLedger: 63,
				hasArchiveVerificationError: false,
				hasWorkerIssue: false,
				latestScannedLedger: 63,
				latestVerifiedLedger: 63,
				scanStatus: 'ok',
				startDate: generatedAt,
				toLedger: 63,
				url: 'https://archive.example'
			}
		],
		archiveScansDeprecated: true,
		archiveScansHistorical: true,
		generatedAt,
		limit: 25,
		networkScans: [
			{
				archiveScheduling: {
					discoveredArchiveUrlCount: 1,
					duplicateSuppressedArchiveScanJobCount: 0,
					scheduledArchiveScanJobCount: 1,
					schedulerErrorCount: 0
				},
				completed: true,
				latestLedger: '100',
				latestLedgerCloseTime: generatedAt,
				ledgersCount: 100,
				status: 'ok',
				time: generatedAt
			}
		]
	};
}

function createLegacyWorkers() {
	return {
		archiveWorkers: {
			activeWorkers: 20,
			configuredWorkerProcesses: 24,
			staleJobAgeMs: 120_000,
			staleWorkers: 0,
			status: 'degraded',
			totalTakenJobs: 20
		},
		communityScanners: {
			activeScanners: 0,
			blacklistedScanners: 0,
			degradedScanners: 0,
			heartbeatFreshnessMs: 300_000,
			offlineScanners: 0,
			status: 'ok',
			totalScanners: 0
		},
		generatedAt,
		status: 'degraded'
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: {};
}
