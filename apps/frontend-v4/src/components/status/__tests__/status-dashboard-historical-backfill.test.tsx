import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveObjectQueue } from '@api/types';
import { parseStatusLiveMessage } from '@api/status-live-stream';
import {
	createStatusLivePayload,
	generatedAt
} from '../../../api/__tests__/support/status-live-contract-fixtures';
import {
	StatusDashboard,
	type StatusDashboardProps
} from '../status-dashboard';

describe('StatusDashboard historical backfill', () => {
	it('does not turn wholly unavailable snapshots into zero or empty claims', () => {
		const props = statusProps();
		const markup = renderToStaticMarkup(
			<StatusDashboard
				{...props}
				archiveEvidenceAvailable={false}
				archiveObjectsAvailable={false}
				workers={{
					...props.workers,
					archiveWorkers: {
						...props.workers.archiveWorkers,
						status: 'unavailable',
						configuredWorkerProcesses: 0,
						workers: []
					}
				}}
				dataQuality={{
					...props.dataQuality,
					scans: {
						...props.dataQuality.scans,
						networkScan: {
							...props.dataQuality.scans.networkScan,
							status: 'unavailable',
							completedScans: 0,
							totalScans: 0
						}
					}
				}}
				fullHistory={{
					...props.fullHistory,
					status: 'unavailable',
					canonicalCoverage: null
				}}
			/>
		);
		expect(markup).toContain('Archive runtime telemetry is unavailable');
		expect(markup).toContain('Network scan counts unavailable');
		expect(markup).toContain('Telemetry unavailable');
		expect(markup).not.toContain('no active object checks at this instant');
		expect(markup).not.toContain('0 configured worker slots');
		expect(markup).not.toContain('0 recent scans');
		expect(markup).not.toContain('No proof-gated checkpoint has been promoted');
	});

	it('includes quantified checkpoint progress in the platform status panel', () => {
		const payload = createStatusLivePayload();
		const fullHistory = record(payload.fullHistory);
		const backfill = record(fullHistory.historicalBackfill);
		backfill.latestErrorCode = 'proof-pending';
		backfill.pendingJobs = 1;
		backfill.state = 'waiting-for-proof';
		const message = parseStatusLiveMessage({
			payload,
			type: 'status'
		});
		if (message?.type !== 'status') {
			throw new Error('Expected a valid status fixture');
		}
		const status = message.payload;
		const markup = renderToStaticMarkup(
			<StatusDashboard
				api={status.api}
				archiveEvents={status.archiveEvents}
				archiveEventsAvailable
				archiveEvidenceAvailable
				archiveObjects={emptyArchiveObjects()}
				archiveObjectsAvailable={false}
				archiveSummary={status.archiveSummary}
				dataQuality={status.dataQuality}
				frontend={status.frontend}
				fullHistory={status.fullHistory}
				scanLogs={status.scanLogs}
				scanLogsAvailable
				workers={status.workers}
			/>
		);

		expect(markup).toContain('Historical index backfill');
		expect(markup).toContain(
			'182 checkpoints indexed; checkpoint 63,386,175 needs 9 more bucket checks on best source'
		);
		expect(markup).toContain('Remote checks pending');
		expect(markup).toContain('1 remote file check awaiting retry');
		expect(markup).toContain('root-checkpoint attestations');
		expect(markup).not.toContain('current checkpoint proof');
		expect(markup).toContain('data-label="Archive source"');
		expect(markup).toContain('data-label="Root attestations verified"');
		expect(markup).toContain('data-label="Scan time"');
		expect(markup).not.toContain('Waiting for proof 63,386,175');
	});
});

function emptyArchiveObjects(): PublicHistoryArchiveObjectQueue {
	return {
		activeObjects: 0,
		failedObjects: 0,
		generatedAt,
		objects: [],
		pendingObjects: 0,
		verifiedObjects: 0
	};
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('Expected a record fixture');
	}
	return value as Record<string, unknown>;
}

function statusProps(): StatusDashboardProps {
	const message = parseStatusLiveMessage({
		payload: createStatusLivePayload(),
		type: 'status'
	});
	if (message?.type !== 'status')
		throw new Error('Expected valid status fixture');
	return {
		...message.payload,
		archiveEvidenceAvailable: true,
		archiveEventsAvailable: true,
		archiveObjects: emptyArchiveObjects(),
		archiveObjectsAvailable: false,
		scanLogsAvailable: true
	};
}
