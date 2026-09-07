import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveFindings } from '../archive-findings';
import { getArchiveFaultCount } from '../archive-finding-model';
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
	archiveFaultCount: 10,
	inconclusiveFailureCount: 0,
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
			attribution: 'archive_fault' as const
		}
	]
};
describe('archive findings attribution', () => {
	it('keeps confirmed responses compact and puts exact diagnostics behind details', () => {
		const html = renderToStaticMarkup(
			<ArchiveFindings source={{ ...source, failureSummary: summary }} />
		);
		expect(html).toContain('7 checkpoints with archive findings');
		expect(html).toContain('SCP · HTTP 503');
		expect(html).toContain('<summary>Exact responses</summary>');
		expect(html).toContain('Remote archive returned HTTP 503');
		expect(html).not.toContain('84');
		expect(html).not.toContain('replacement used');
	});
	it.each(['aborted', 'ERR_CANCELED', 'read ECONNRESET', 'Connection timeout'])(
		'does not blame archives for incomplete exchanges: %s',
		(message) => {
			const row = {
				...source,
				failureSummary: {
					...summary,
					archiveFaultCount: 0,
					inconclusiveFailureCount: 10,
					knownAffectedCheckpointCount: 0,
					groups: [
						{
							...summary.groups[0],
							attribution: 'inconclusive' as const,
							httpStatus: 200,
							errorType: 'archive_transport_error',
							errorMessage: message
						}
					]
				}
			};
			const html = renderToStaticMarkup(<ArchiveFindings source={row} />);
			expect(html).toContain('No unresolved archive faults');
			expect(html).not.toContain(message);
			expect(html).not.toContain('HTTP 200');
		}
	);
	it('does not hide new failures behind an older zero snapshot', () => {
		const row = {
			...source,
			failureSummary: {
				...summary,
				status: 'stale' as const,
				remoteFailureCount: 0,
				archiveFaultCount: 0,
				knownAffectedCheckpointCount: 0,
				groups: []
			}
		};
		expect(getArchiveFaultCount(row)).toBeNull();
		expect(renderToStaticMarkup(<ArchiveFindings source={row} />)).toContain(
			'refreshing'
		);
	});
	it('does not use a stale positive fault count as the current count', () => {
		expect(
			getArchiveFaultCount({
				...source,
				archiveEvidenceFailures: 2,
				failureSummary: summary
			})
		).toBeNull();
	});
	it('does not invent a count before classification is ready', () => {
		expect(getArchiveFaultCount(source)).toBeNull();
		expect(
			renderToStaticMarkup(<ArchiveFindings source={source} />)
		).not.toContain('10 checkpoints');
	});
	it('classifies complete older snapshots using the same transport predicate', () => {
		const row = {
			...source,
			failureSummary: {
				...summary,
				archiveFaultCount: undefined,
				inconclusiveFailureCount: undefined,
				groups: [
					{
						...summary.groups[0],
						attribution: undefined,
						httpStatus: 200,
						errorMessage: 'aborted'
					}
				]
			}
		};
		expect(getArchiveFaultCount(row)).toBe(0);
	});
});
