/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveStatusSummary,
	PublicScanLogStatus
} from '@api/types';
import { StatusArchiveEvidenceTables } from '../archive-status-tables';
import { RecentScanLogs } from '../recent-scan-logs';

const generatedAt = '2026-07-11T00:00:00.000Z';

describe('status drilldown availability', () => {
	it('does not render an unfetched network log as an empty result', () => {
		const html = renderToStaticMarkup(
			<RecentScanLogs available={false} scanLogs={emptyScanLogs()} />
		);

		expect(html).toContain('Recent network scan history loading');
		expect(html).not.toContain('No network scans');
	});

	it('does not render unfetched archive events as zero activity', () => {
		const html = renderToStaticMarkup(
			<StatusArchiveEvidenceTables
				events={emptyArchiveEvents()}
				eventsAvailable={false}
				finding={{
					detail: 'Archive evidence is loading.',
					pillText: 'Evidence unavailable',
					tone: undefined,
					value: 'Archive evidence unavailable'
				}}
				health={{
					facts: {
						activeChecks: 0,
						checkpointMismatches: 0,
						expectedCheckpointProofs: 0,
						failedEvidenceRows: 0,
						failingArchiveSources: 0,
						provenCheckpointProofs: 0,
						remoteHostFailures: 0,
						scannerIssues: 0,
						unclassifiedFailures: 0,
						waitingChecks: 0
					},
					state: 'unknown'
				}}
				summary={emptyArchiveSummary()}
			/>
		);

		expect(html).toContain('Recent archive activity loading');
		expect(html).not.toContain('0 events');
	});

	it('reports tracked proof checks instead of the theoretical full-history total', () => {
		const summary = emptyArchiveSummary();
		const html = renderToStaticMarkup(
			<StatusArchiveEvidenceTables
				events={emptyArchiveEvents()}
				eventsAvailable
				finding={{
					detail: 'Archive evidence is being evaluated.',
					pillText: 'Checking',
					tone: undefined,
					value: 'Checks in progress'
				}}
				health={{
					facts: {
						activeChecks: 24,
						checkpointMismatches: 8,
						expectedCheckpointProofs: 75_314_129,
						failedEvidenceRows: 0,
						failingArchiveSources: 0,
						provenCheckpointProofs: 0,
						remoteHostFailures: 0,
						scannerIssues: 0,
						unclassifiedFailures: 0,
						waitingChecks: 76_310
					},
					state: 'checking'
				}}
				summary={{
					...summary,
					checkpointCoverage: {
						...summary.checkpointCoverage,
						categoryConsistencyFailedCheckpoints: 8,
						categoryConsistencyPendingCheckpoints: 71_187,
						expectedArchiveCheckpoints: 75_314_129,
						totalArchiveCheckpoints: 76_318
					}
				}}
			/>
		);

		expect(html).toContain('0 of 76,318 tracked checks verified');
		expect(html).toContain('Confirmed mismatch');
		expect(html).not.toContain('75,314,129');
	});
});

function emptyScanLogs(): PublicScanLogStatus {
	return {
		archiveScans: [],
		archiveScansDeprecated: true,
		archiveScansHistorical: true,
		generatedAt,
		limit: 25,
		networkScans: []
	};
}

function emptyArchiveEvents(): PublicHistoryArchiveObjectEvents {
	return { count: 0, events: [], generatedAt, limit: 100 };
}

function emptyArchiveSummary(): PublicHistoryArchiveStatusSummary {
	return {
		activeObjectChecks: 0,
		archiveEvidenceFailures: 0,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 0,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 0,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 0,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 0,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: null,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 0,
			oldestCheckpointLedger: null,
			partialArchiveCheckpoints: 0,
			totalArchiveCheckpoints: 0
		},
		generatedAt,
		scannerIssueFailures: 0,
		sourceCount: 0,
		sourceLimit: 256,
		sources: [],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}
