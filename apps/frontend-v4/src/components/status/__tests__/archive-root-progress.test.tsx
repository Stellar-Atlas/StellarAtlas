import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	ArchiveRootProgressTable,
	getArchiveRootProgress
} from '../archive-root-progress';
import type { PublicHistoryArchiveStatusSummary } from '@api/types';

type ArchiveSource = PublicHistoryArchiveStatusSummary['sources'][number];

const source = {
	archiveUrl: 'https://archive.example/root',
	archiveUrlIdentity: 'https://archive.example/root',
	currentLedger: 641,
	latestCheckpointLedger: 639,
	latestDiscoveredCheckpointLedger: 640,
	verifiedCheckpointProofs: 2,
	durableVerifiedCheckpointProofs: 8,
	totalCheckpointProofs: 10,
	scanCoverage: {
		checkedCheckpointPositions: 4,
		listingCoveredCheckpointPositions: 3,
		scannedCheckpointPositions: 7,
		status: 'reconciling',
		updatedAt: null
	},
	activeObjectChecks: 3,
	pendingCheckpointProofs: 5,
	notEvaluableCheckpointProofs: 1
} as ArchiveSource;

describe('archive root progress', () => {
	it('uses verified and scanned counts without claiming scheduler position', () => {
		expect(getArchiveRootProgress(source)).toEqual({
			expected: 10,
			verified: 8,
			scanned: 7,
			scanStatus: 'reconciling'
		});
	});

	it('renders two progress measures and current check counts per root', () => {
		const html = renderToStaticMarkup(
			createElement(ArchiveRootProgressTable, { sources: [source] })
		);
		expect(html).toContain('Durable verified checkpoint evidence for https://archive.example/root');
		expect(html).toContain('Scanned checkpoint positions for https://archive.example/root');
		expect(html.match(/<progress/g)).toHaveLength(2);
		expect(html).toContain('8 / 10 durable verified');
		expect(html).toContain('7 / 10 scanned · reconciling');
		expect(html).toContain('3 active');
		expect(html).toContain('5 waiting');
		expect(html).toContain('1 incomplete');
		expect(html).not.toMatch(/scheduler position|next checkpoint/i);
	});
});
