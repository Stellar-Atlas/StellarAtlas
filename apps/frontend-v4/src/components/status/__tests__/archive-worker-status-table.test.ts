import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkerStatusDTO } from '@api/types';
import { ArchiveWorkerStatusTable } from '../archive-worker-status-table';

describe('ArchiveWorkerStatusTable', () => {
	it('renders worker progress without exposing archive URL paths', () => {
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, { workers: createStatus() })
		);

		expect(markup).toContain('object-host-17-0');
		expect(markup).toContain('Slot 17');
		expect(markup).toContain('Slot 0');
		expect(markup).toContain('No recent worker registration.');
		expect(markup).toContain('PID 4,123');
		expect(markup).toContain('downloading bucket');
		expect(markup).toContain('8.0 KiB / 16.0 KiB');
		expect(markup).toContain('max="16384"');
		expect(markup).toContain('value="8192"');
		expect(markup).toContain('Attempt 3');
		expect(markup).toContain('archive.example');
		expect(markup).not.toContain('/private/archive/path');
	});

	it('renders legacy aggregate activity without inventing zero registrations', () => {
		const status = createStatus();
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, {
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						activeWorkers: 20,
						configuredWorkerProcesses: 24,
						freshWorkers: 20,
						registeredWorkers: 20,
						telemetryMode: 'aggregate-only',
						workers: []
					}
				}
			})
		);

		expect(markup).toContain('20 / 24 active (aggregate telemetry)');
		expect(markup).toContain(
			'Per-worker telemetry is unavailable during mixed rollout.'
		);
		expect(markup).not.toContain('0 / 24 fresh');
	});

	it('renders all configured slots in stable numeric order without pagination', () => {
		const status = createStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker === undefined) throw new Error('Expected worker fixture');
		const workers = Array.from({ length: 24 }, (_, slotIndex) => ({
			...worker,
			slotIndex,
			workerId: `object-host-${slotIndex.toString()}-0`
		})).reverse();
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, {
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						workers
					}
				}
			})
		);

		expect(markup).toContain('object-host-0-0');
		expect(markup).toContain('object-host-23-0');
		expect(markup).toContain('Slot 23');
		expect(markup.indexOf('object-host-2-0')).toBeLessThan(
			markup.indexOf('object-host-10-0')
		);
		expect(markup).not.toContain('Archive worker pages');
		expect(markup).not.toContain('1-8 of');
	});

	it('renders unknown transfer sizes as indeterminate progress', () => {
		const status = createStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker === undefined) throw new Error('Expected worker fixture');
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, {
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						configuredWorkerProcesses: 1,
						workers: [{ ...worker, bytesTotal: null, slotIndex: 0 }]
					}
				}
			})
		);

		expect(markup).toContain('<progress');
		expect(markup).toContain('8.0 KiB transferred');
		expect(markup).not.toContain('max=');
		expect(markup).not.toContain('value=');
	});
});

function createStatus(): WorkerStatusDTO {
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
						source: 'https://archive.example/private/archive/path',
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
