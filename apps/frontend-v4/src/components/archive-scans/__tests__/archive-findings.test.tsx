import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveFindings } from '../archive-findings';
import type { ArchiveSource } from '../archive-inventory-model';
const source = {
	archiveUrl: 'https://example.org',
	archiveEvidenceFailures: 10,
	listingGapCount: 0,
	mismatchCheckpointProofs: 0,
	unclassifiedFailures: 0
} as ArchiveSource;
const summary = {
	status: 'current' as const,
	computedAt: '2026-09-07T00:00:00Z',
	limit: 20,
	totalGroups: 1,
	remainingGroupCount: 0,
	remainingFailureCount: 0,
	remoteFailureCount: 10,
	workerIssueCount: 84,
	knownAffectedCheckpointCount: 7,
	unknownCheckpointFailureCount: 0,
	groups: [
		{
			objectType: 'scp' as const,
			failureChannel: 'archive_availability' as const,
			errorType: 'archive_http_error',
			errorMessage: 'Remote archive returned HTTP 503',
			httpStatus: 503,
			count: 10,
			knownAffectedCheckpointCount: 7,
			unknownCheckpointFailureCount: 0
		}
	]
};
describe('archive findings explain evidence', () => {
	it('shows distinct affected checkpoints and exact category/reason without treating worker issues as source failures', () => {
		const html = renderToStaticMarkup(
			<ArchiveFindings source={{ ...source, failureSummary: summary }} />
		);
		expect(html).toContain('7 checkpoints with unresolved checks');
		expect(html).toContain('10 SCP · HTTP 503');
		expect(html).toContain('Remote archive returned HTTP 503');
		expect(html).not.toContain('84');
		expect(html).not.toContain('404');
		expect(html).not.toContain('replacement used');
	});
	it('keeps listing evidence and checkpoint boundaries separate from request failures', () => {
		const html = renderToStaticMarkup(
			<ArchiveFindings
				source={{
					...source,
					archiveEvidenceFailures: 0,
					listingGapCount: 1,
					listingGapRanges: [
						{
							firstCheckpointLedger: 63,
							lastCheckpointLedger: 191,
							checkpointCount: 3,
							observedAt: '2026-09-07T00:00:00Z',
							kind: 'gcs-listing'
						}
					]
				}}
			/>
		);
		expect(html).toContain('No unresolved file checks');
		expect(html).toContain('1 range absent from filename listings');
		expect(html).toContain('Ledger 63–191');
		expect(html).toContain('3 checkpoint positions');
		expect(html).toContain('not individual HTTP failures');
	});
	it('does not hide new failures behind an older zero snapshot', () => {
		const html = renderToStaticMarkup(
			<ArchiveFindings
				source={{
					...source,
					failureSummary: {
						...summary,
						status: 'stale',
						remoteFailureCount: 0,
						knownAffectedCheckpointCount: 0,
						groups: []
					}
				}}
			/>
		);
		expect(html).not.toContain('No unresolved file checks');
		expect(html).toContain('refreshing');
		expect(html).not.toContain('0 checkpoints with unresolved checks');
	});
	it('does not invent affected checkpoint counts from a file total before summary is ready', () => {
		const html = renderToStaticMarkup(<ArchiveFindings source={source} />);
		expect(html).toContain('reason summary is being prepared');
		expect(html).not.toContain('10 checkpoints');
	});
});
