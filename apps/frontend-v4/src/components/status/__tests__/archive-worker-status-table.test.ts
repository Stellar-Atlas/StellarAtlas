import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkerStatusDTO } from '@api/types';
import { getArchiveDownloadActivity } from '../archive-download-activity';
import {
	archiveWorkerPageSize,
	createWorkerSlots,
	formatArchiveWorkerCapacity
} from '../archive-worker-table-model';
import { getStatusTablePage } from '../status-table-pagination';
import { ArchiveWorkerStatusTable } from '../archive-worker-status-table';

describe('ArchiveWorkerStatusTable', () => {
	it('counts only stages that still hold a network permit', () => {
		const worker = createStatus().archiveWorkers.workers[0]!;
		const processingWorker: typeof worker = {
			...worker,
			stage: 'verifying_bucket'
		};
		const waitingWorker: typeof worker = {
			...worker,
			currentObject: null,
			stage: 'waiting_for_download_slot',
			status: 'idle'
		};

		expect(getArchiveDownloadActivity([worker])).toEqual({
			activeDownloads: 1,
			waitingForDownloadSlots: 0
		});
		expect(
			getArchiveDownloadActivity([processingWorker, waitingWorker])
		).toEqual({ activeDownloads: 0, waitingForDownloadSlots: 1 });
	});

	it('renders worker progress without exposing archive URL paths', () => {
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, { workers: createStatus() })
		);

		expect(markup).toContain('object-host-0-0');
		expect(markup).toContain('Slot 0');
		expect(markup).toContain('Slot 0');
		expect(markup).toContain('No recent worker registration.');
		expect(markup).toContain('PID 4,123');
		expect(markup).toContain('data-label="Current file"');
		expect(markup).toContain('24 configured worker slots; 1 observed process');
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

	it('renders eight stable numeric slots and makes the last page reachable', () => {
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
		expect(markup).not.toContain('object-host-23-0');
		expect(markup).toContain('Slot 7');
		expect(markup.indexOf('object-host-2-0')).toBeLessThan(
			markup.indexOf('object-host-7-0')
		);
		expect(markup).toContain('Archive worker pages');
		expect(markup).toContain('1-8 of');
		const last = getStatusTablePage(
			createWorkerSlots(workers, 24),
			2,
			archiveWorkerPageSize
		);
		expect(last.rows.map((slot) => slot.slotIndex)).toEqual([
			16, 17, 18, 19, 20, 21, 22, 23
		]);
	});
	it('keeps all 120 slots accessible without reshuffling when worker states change', () => {
		const status = createStatus();
		const worker = status.archiveWorkers.workers[0];
		if (worker === undefined) throw new Error('Expected worker fixture');
		const workers = Array.from({ length: 120 }, (_, slotIndex) => ({
			...worker,
			currentObject: slotIndex === 70 ? worker.currentObject : null,
			lastOutcome:
				slotIndex === 71 ? ('archive_error' as const) : ('verified' as const),
			slotIndex,
			stage: slotIndex === 70 ? worker.stage : ('idle' as const),
			status:
				slotIndex === 70
					? ('active' as const)
					: slotIndex === 71
						? ('stale' as const)
						: ('idle' as const),
			workerId: `object-host-${slotIndex.toString()}-0`
		}));
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, {
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						configuredWorkerProcesses: 120,
						workers
					}
				}
			})
		);

		expect(markup).toContain('1-8 of');
		expect(markup).toContain('120 configured worker slots; 1 observed process');
		expect(markup).not.toContain('object-host-70-0');
		const slots = createWorkerSlots(workers, 120);
		const pages = Array.from(
			{ length: 15 },
			(_, page) => getStatusTablePage(slots, page, archiveWorkerPageSize).rows
		);
		expect(pages.flat().map((slot) => slot.slotIndex)).toEqual(
			Array.from({ length: 120 }, (_, index) => index)
		);
		expect(pages[8]?.map((slot) => slot.slotIndex)).toContain(70);
		expect(pages[8]?.map((slot) => slot.slotIndex)).toContain(71);
		expect(pages[14]?.at(-1)?.worker?.slotIndex).toBe(119);
		const changed = workers.map((worker) => ({
			...worker,
			status: 'idle' as const
		}));
		expect(
			createWorkerSlots(changed, 120).map((slot) => slot.slotIndex)
		).toEqual(slots.map((slot) => slot.slotIndex));
	});

	it('counts observed processes separately from slots', () => {
		const status = createStatus().archiveWorkers;
		const worker = status.workers[0]!;
		const workers = Array.from({ length: 120 }, (_, slotIndex) => ({
			...worker,
			slotIndex,
			processId: 'process-' + Math.floor(slotIndex / 10)
		}));
		expect(
			formatArchiveWorkerCapacity({
				...status,
				configuredWorkerProcesses: 120,
				workers
			})
		).toBe('120 configured worker slots; 12 observed processes');
	});

	it('does not present missing worker telemetry as zero fresh workers', () => {
		const status = createStatus();
		const markup = renderToStaticMarkup(
			createElement(ArchiveWorkerStatusTable, {
				workers: {
					...status,
					archiveWorkers: {
						...status.archiveWorkers,
						status: 'unavailable',
						configuredWorkerProcesses: 0,
						workers: []
					}
				}
			})
		);
		expect(markup).toContain('Worker telemetry unavailable');
		expect(markup).not.toContain('0 / 0');
		expect(markup).not.toContain('No recent worker registrations.');
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
					slotIndex: 0,
					stage: 'downloading_bucket',
					status: 'active',
					workerId: 'object-host-0-0'
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
