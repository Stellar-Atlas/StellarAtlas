import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveObjectQueue } from '@api/types';
import { parseStatusLiveMessage } from '@api/status-live-stream';
import {
	createStatusLivePayload,
	generatedAt
} from '../../../api/__tests__/support/status-live-contract-fixtures';
import { StatusDashboard } from '../status-dashboard';

describe('StatusDashboard historical backfill', () => {
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
		expect(markup).toContain('Remote evidence');
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
