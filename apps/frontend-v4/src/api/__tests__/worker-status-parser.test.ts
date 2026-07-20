import { parseStatusLiveMessage } from '../status-live-stream';
import { parseWorkerStatusDTO } from '../worker-status-parser';

describe('worker status parsing', () => {
	it('accepts the typed aggregate and per-worker contract', () => {
		const parsed = parseWorkerStatusDTO(createWorkerStatus());

		expect(parsed?.archiveWorkers.workers[0]).toMatchObject({
			bytesTotal: 16384,
			claimAttempt: 3,
			pid: 4123,
			processGeneration: 2,
			slotIndex: 17,
			stage: 'downloading_bucket',
			workerId: 'object-host-17-0'
		});
	});

	it('normalizes an omitted transfer total and sorts numeric slots', () => {
		const status = createWorkerStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker === undefined) throw new Error('worker fixture must exist');
		const parsed = parseWorkerStatusDTO({
			...status,
			archiveWorkers: {
				...status.archiveWorkers,
				workers: [
					{ ...worker, slotIndex: 10, workerId: 'worker-10' },
					{
						...worker,
						bytesTotal: undefined,
						slotIndex: 2,
						workerId: 'worker-2'
					}
				]
			}
		});

		expect(
			parsed?.archiveWorkers.workers.map((row) => [
				row.slotIndex,
				row.bytesTotal
			])
		).toEqual([
			[2, null],
			[10, 16384]
		]);
	});

	it('rejects out-of-range slots and invalid transfer totals', () => {
		const status = createWorkerStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker === undefined) throw new Error('worker fixture must exist');

		expect(
			parseWorkerStatusDTO({
				...status,
				archiveWorkers: {
					...status.archiveWorkers,
					workers: [{ ...worker, slotIndex: 24 }]
				}
			})
		).toBeNull();
		expect(
			parseWorkerStatusDTO({
				...status,
				archiveWorkers: {
					...status.archiveWorkers,
					workers: [{ ...worker, bytesTotal: -1 }]
				}
			})
		).toBeNull();
	});

	it('preserves legacy aggregate activity during mixed rollout', () => {
		const status = createWorkerStatus();
		const parsed = parseWorkerStatusDTO({
			archiveWorkers: {
				activeWorkers: 20,
				configuredWorkerProcesses: 24,
				staleJobAgeMs: 120_000,
				staleWorkers: 0,
				status: 'degraded',
				totalTakenJobs: 20
			},
			communityScanners: status.communityScanners,
			generatedAt: status.generatedAt,
			status: 'degraded'
		});

		expect(parsed?.archiveWorkers).toMatchObject({
			activeWorkers: 20,
			freshWorkers: 20,
			registeredWorkers: 20,
			telemetryMode: 'aggregate-only'
		});
		expect(parsed?.archiveWorkers.workers).toEqual([]);
	});

	it('rejects internal paths and unknown free-form stages', () => {
		const status = createWorkerStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker?.currentObject === null || worker === undefined) {
			throw new Error('worker fixture must be active');
		}

		expect(
			parseWorkerStatusDTO({
				...status,
				archiveWorkers: {
					...status.archiveWorkers,
					workers: [
						{
							...worker,
							currentObject: {
								...worker.currentObject,
								source: '/srv/history/private'
							}
						}
					]
				}
			})
		).toBeNull();
		expect(
			parseWorkerStatusDTO({
				...status,
				archiveWorkers: {
					...status.archiveWorkers,
					workers: [{ ...worker, stage: 'running arbitrary command' }]
				}
			})
		).toBeNull();
	});

	it('parses worker rows in WebSocket patches before rendering them', () => {
		const status = createWorkerStatus();
		const message = parseStatusLiveMessage({
			payload: {
				generatedAt: status.generatedAt,
				workers: status
			},
			type: 'status-patch'
		});

		expect(message?.type).toBe('status-patch');
		if (message?.type !== 'status-patch') return;
		expect(message.payload.workers?.archiveWorkers.workers).toHaveLength(1);
	});

	it('strips unknown nested worker keys from WebSocket patches', () => {
		const status = createWorkerStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker?.currentObject === null || worker === undefined) {
			throw new Error('worker fixture must be active');
		}
		const message = parseStatusLiveMessage({
			payload: {
				generatedAt: status.generatedAt,
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						internalRegistryPath: '/srv/private/registry',
						workers: [
							{
								...worker,
								currentObject: {
									...worker.currentObject,
									query: 'token=secret'
								},
								internalSequence: 44
							}
						]
					}
				}
			},
			type: 'status-patch'
		});

		expect(message?.type).toBe('status-patch');
		expect(JSON.stringify(message)).not.toContain('internalRegistryPath');
		expect(JSON.stringify(message)).not.toContain('internalSequence');
		expect(JSON.stringify(message)).not.toContain('token=secret');
		expect(JSON.stringify(message)).not.toContain('/srv/private/registry');
	});
});

function createWorkerStatus() {
	return {
		archiveWorkers: {
			activeWorkers: 1,
			configuredWorkerProcesses: 24,
			freshWorkers: 1,
			idleWorkers: 0,
			lastHeartbeatAt: '2026-07-10T12:09:58.000Z',
			missingWorkers: 23,
			queueActiveWorkers: 1,
			queueStaleWorkers: 0,
			registeredWorkers: 1,
			staleJobAgeMs: 120_000,
			staleWorkers: 0,
			startupGraceActive: false,
			startupGraceMs: 120_000,
			status: 'degraded',
			telemetryMode: 'per-worker',
			totalTakenJobs: 1,
			workers: [
				{
					bytesDownloaded: 8192,
					bytesTotal: 16384,
					claimAttempt: 3,
					currentObject: {
						remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
						source: 'https://archive.example',
						type: 'bucket'
					},
					heartbeatAgeMs: 2000,
					lastHeartbeatAt: '2026-07-10T12:09:58.000Z',
					lastOutcome: 'verified',
					lastOutcomeAt: '2026-07-10T12:08:00.000Z',
					pid: 4123,
					processGeneration: 2,
					processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
					processStartedAt: '2026-07-10T12:00:00.000Z',
					slotIndex: 17,
					stage: 'downloading_bucket',
					status: 'active',
					workerId: 'object-host-17-0'
				}
			]
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
		generatedAt: '2026-07-10T12:10:00.000Z',
		status: 'degraded'
	};
}
