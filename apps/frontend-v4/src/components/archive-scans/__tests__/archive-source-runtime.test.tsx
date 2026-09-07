/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseStatusLiveMessage } from '@api/status-live-stream';
import { createStatusLivePayload } from '@api/__tests__/support/status-live-contract-fixtures';
import type { ArchiveWorkerStatusRowDTO, PublicWorkerStatus } from '@api/types';
import { formatObjectStatus } from '../known-archive-evidence-table-parts';
import {
	ArchiveSourceRuntime,
	ArchiveSourceRuntimeView
} from '../archive-source-runtime';
import {
	getArchiveSourceRuntime,
	selectSourceWorkerSnapshot
} from '../archive-source-runtime-model';

const now = Date.parse('2026-07-10T12:10:00.000Z');
const root = 'https://archive.example/Case';

function snapshot(): PublicWorkerStatus {
	const parsed = parseStatusLiveMessage({
		type: 'status',
		payload: createStatusLivePayload()
	});
	if (parsed?.type !== 'status')
		throw new Error('Expected valid worker fixture');
	return parsed.payload.workers;
}

function worker(
	overrides: Partial<ArchiveWorkerStatusRowDTO> = {}
): ArchiveWorkerStatusRowDTO {
	return {
		workerId: 'worker-1',
		slotIndex: 1,
		pid: 10,
		processGeneration: 0,
		processId: 'process-1',
		processStartedAt: new Date(now - 60_000).toISOString(),
		status: 'active',
		stage: 'recording_archive_evidence',
		lastHeartbeatAt: new Date(now - 1000).toISOString(),
		heartbeatAgeMs: 1000,
		bytesDownloaded: 1024,
		bytesTotal: null,
		claimAttempt: 1,
		lastOutcome: 'none',
		lastOutcomeAt: null,
		currentObject: { remoteId: 'object-1', source: root, type: 'ledger' },
		...overrides
	};
}

function model(
	rows: readonly ArchiveWorkerStatusRowDTO[] = [worker()],
	options: {
		readonly now?: number;
		readonly streamError?: boolean;
		readonly workers?: PublicWorkerStatus | null;
	} = {}
) {
	const base = snapshot();
	return getArchiveSourceRuntime({
		archiveUrl: `${root}/`,
		now,
		lastReceivedAt: now,
		startedAt: now,
		streamError: false,
		workers: {
			...base,
			archiveWorkers: {
				...base.archiveWorkers,
				workers: rows,
				status: 'ok',
				telemetryMode: 'per-worker',
				configuredWorkerProcesses: 2,
				freshWorkers: 2,
				missingWorkers: 0,
				staleWorkers: 0,
				staleJobAgeMs: 120_000,
				queueActiveWorkers: 0
			}
		},
		...options
	});
}

describe('source worker runtime', () => {
	it('labels durable pending rows as queued, not worker activity', () => {
		expect(formatObjectStatus({ status: 'pending' })).toBe('Queued');
	});
	it('uses live slots even when durable scanning count is zero, preserving path case and exact root', () => {
		const result = model([
			worker(),
			worker({
				workerId: 'other-case',
				currentObject: {
					remoteId: '2',
					source: root.toLowerCase(),
					type: 'ledger'
				}
			}),
			worker({
				workerId: 'child',
				currentObject: {
					remoteId: '3',
					source: `${root}/child`,
					type: 'ledger'
				}
			}),
			worker({
				workerId: 'trailing',
				slotIndex: 0,
				currentObject: { remoteId: '4', source: `${root}/`, type: 'bucket' }
			})
		]);
		expect(result.activeRows.map((row) => row.workerId)).toEqual([
			'trailing',
			'worker-1'
		]);
		expect(result.status).toBe('current');
	});
	it('rejects stale and idle rows rather than counting every currentObject as busy', () => {
		const result = model([
			worker({ status: 'stale' }),
			worker({ workerId: 'idle', status: 'idle' }),
			worker({
				workerId: 'old',
				lastHeartbeatAt: new Date(now - 120_000).toISOString()
			})
		]);
		expect(result.activeRows).toEqual([]);
	});
	it('marks an expired or error-only stream unknown and preserves last observations', () => {
		for (const result of [
			model(undefined, { now: now + 15_000 }),
			model(undefined, { streamError: true })
		]) {
			expect(result.status).toBe('stale');
			expect(result.activeRows).toEqual([]);
			expect(result.lastReportedRows).toHaveLength(1);
			const html = renderToStaticMarkup(
				createElement(ArchiveSourceRuntimeView, { model: result })
			);
			expect(html).toContain('Current activity is unknown');
			expect(html).toContain('Last reported slots (not live)');
			expect(html).not.toContain('No active worker slots');
		}
	});
	it('never uses missing initial telemetry as an idle/zero result', () => {
		expect(model([], { workers: null }).status).toBe('connecting');
		const missing = model([], { workers: null, now: now + 15_000 });
		expect(missing.status).toBe('unavailable');
		const html = renderToStaticMarkup(
			createElement(ArchiveSourceRuntime, { archiveUrl: root })
		);
		expect(html).toContain('Connecting worker telemetry');
		expect(html).not.toContain('No active');
	});
	it('labels recording evidence accurately instead of implying network downloading', () => {
		const html = renderToStaticMarkup(
			createElement(ArchiveSourceRuntimeView, { model: model() })
		);
		expect(html).toContain('1 active worker slots reported');
		expect(html).toContain('recording archive evidence');
		expect(html).toContain('1,024 bytes received');
		expect(html).not.toContain('downloading');
	});
	it('does not let an older worker snapshot regress current evidence', () => {
		const current = snapshot();
		const older = {
			...current,
			generatedAt: new Date(now - 1000).toISOString()
		};
		expect(selectSourceWorkerSnapshot(current, older)).toBe(current);
		expect(selectSourceWorkerSnapshot(null, older)).toBe(older);
	});
	it('does not claim complete telemetry when worker slots are missing', () => {
		const current = snapshot();
		const partial = {
			...current,
			archiveWorkers: {
				...current.archiveWorkers,
				telemetryMode: 'per-worker' as const,
				status: 'degraded' as const,
				workers: [],
				missingWorkers: 1,
				configuredWorkerProcesses: 2,
				freshWorkers: 1
			}
		};
		const result = model([], { workers: partial });
		expect(result.completeTelemetry).toBe(false);
		const html = renderToStaticMarkup(
			createElement(ArchiveSourceRuntimeView, { model: result })
		);
		expect(html).toContain('worker telemetry is incomplete');
	});
});
