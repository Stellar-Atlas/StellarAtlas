import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoryArchiveStatusSummary } from '@api/types';
import {
	ArchiveRootInventory,
	calculateCoveragePercent,
	formatCoveragePercent,
	getExpectedArchiveCheckpointCount
} from '../archive-root-inventory';

describe('archive root checkpoint coverage', () => {
	it('derives the full checkpoint range instead of using sparse proof rows', () => {
		expect(
			getExpectedArchiveCheckpointCount({
				currentLedger: 64_257_663,
				latestCheckpointLedger: 64_256_255,
				latestDiscoveredCheckpointLedger: 64_257_663
			})
		).toBe(1_004_026);
		expect(
			getExpectedArchiveCheckpointCount({
				currentLedger: 127,
				latestCheckpointLedger: null,
				latestDiscoveredCheckpointLedger: null
			})
		).toBe(2);
	});

	it('keeps near-complete and sparse archive coverage honest', () => {
		const canonical = calculateCoveragePercent(1_004_004, 1_004_026);
		expect(formatCoveragePercent(canonical)).toBe('99.998%');
		expect(formatCoveragePercent(calculateCoveragePercent(50, 1_004_026))).toBe(
			'<0.01%'
		);
	});

	it('renders highest verified coverage first and accessible sortable headers', () => {
		const summary: PublicHistoryArchiveStatusSummary = {
			activeObjectChecks: 0,
			generatedAt: '2026-09-06T09:00:00Z',
			sourceCount: 0,
			sourceLimit: 256,
			archiveEvidenceFailures: 0,
			scannerIssueFailures: 0,
			sources: [],
			sourcesTruncated: false,
			unclassifiedFailures: 0,
			transitionReconciliation: {
				oldestPendingAgeMs: null,
				oldestPendingAt: null,
				pendingTerminalEffects: 0,
				status: 'caught-up'
			},
			checkpointCoverage: {
				activeArchiveCheckpoints: 0,
				archiveRootsWithState: 0,
				categoryConsistencyFailedCheckpoints: 0,
				categoryConsistencyNotEvaluatedCheckpoints: 0,
				categoryConsistencyPendingCheckpoints: 0,
				categoryConsistentArchiveCheckpoints: 0,
				completeArchiveCheckpoints: 0,
				durableVerifiedArchiveCheckpoints: 0,
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
			canonicalProofProgress: {
				archiveUrl: null,
				archiveUrlIdentity: null,
				verifiedCheckpoints: 0,
				totalCheckpoints: 0,
				latestVerifiedCheckpointLedger: null,
				nextCheckpointLedger: null,
				targetCheckpointLedger: null,
				remainingCheckpoints: 0
			}
		};
		const html = renderToStaticMarkup(
			createElement(ArchiveRootInventory, {
				nodes: [],
				organizations: [],
				summary
			})
		);
		expect(html).toContain('aria-label="Sort archive roots"');
		expect(html).toContain(
			'<option value="coverage-desc" selected="">Verified coverage high to low</option>'
		);
		expect(html).toContain('aria-sort="descending"');
		expect(html).toContain('title="Sort verified coverage ascending"');
		expect(html).toContain('title="Sort archive source ascending"');
		expect(html).toContain('title="Sort archive findings descending"');
		for (const option of [
			'failures',
			'validator',
			'organization',
			'coverage-asc',
			'url'
		]) {
			expect(html).toContain('<option value="' + option + '">');
		}
	});
});
