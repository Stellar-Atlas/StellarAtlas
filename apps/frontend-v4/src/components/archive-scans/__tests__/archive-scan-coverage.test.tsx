import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveScanCoverage } from '../archive-scan-coverage';
import {
	getKnownScannedPositions,
	type ArchiveSource,
	compareSources
} from '../archive-inventory-model';
const root = {
	archiveUrl: 'https://archive.example',
	archiveUrlIdentity: 'https://archive.example',
	currentLedger: 639,
	latestCheckpointLedger: 639,
	latestDiscoveredCheckpointLedger: 639,
	durableVerifiedCheckpointProofs: 3
} as ArchiveSource;
const coverage = {
	checkedCheckpointPositions: 5,
	listingCoveredCheckpointPositions: 4,
	scannedCheckpointPositions: 7,
	status: 'complete' as const,
	updatedAt: null
};
describe('separate scan coverage', () => {
	it('renders the distinct union rather than summing categories or listing overlap', () => {
		const html = renderToStaticMarkup(
			<ArchiveScanCoverage source={{ ...root, scanCoverage: coverage }} />
		);
		expect(html).toContain('70.00%');
		expect(html).toContain('7 / 10 positions');
		expect(html).toContain('30.00% verified');
		expect(html).toContain('5 checked');
		expect(html).toContain('archive-scan-meter-listing');
		expect(html).toContain('width:40%');
		expect(html).toContain('width:30%');
		expect(html).toContain('4 listing-covered');
		expect(html).not.toContain('≥');
		expect(html).not.toContain('90.00%');
	});
	it('labels an incomplete historic seed as a minimum and never adds unseeded verified counts', () => {
		const source = {
			...root,
			durableVerifiedCheckpointProofs: 6,
			scanCoverage: {
				...coverage,
				scannedCheckpointPositions: 5,
				status: 'reconciling' as const
			}
		};
		expect(getKnownScannedPositions(source)).toBe(6);
		const html = renderToStaticMarkup(<ArchiveScanCoverage source={source} />);
		expect(html).toContain('≥60.00%');
		expect(html).toContain('At least 6 / 10 positions');
		expect(html).toContain('Historical count reconciling');
	});
	it('does not count untouched proof queue rows as scans during rolling deployment', () => {
		const source = {
			...root,
			totalCheckpointProofs: 10,
			pendingCheckpointProofs: 7
		} as ArchiveSource;
		expect(getKnownScannedPositions(source)).toBe(3);
	});
	it('sorts examined coverage independently of passed proofs', () => {
		const checked = { ...root, scanCoverage: coverage };
		const verified = {
			...root,
			archiveUrl: 'https://other.example',
			archiveUrlIdentity: 'https://other.example',
			durableVerifiedCheckpointProofs: 6
		};
		const context = { advertisers: new Map(), organizationNames: new Map() };
		expect(
			compareSources(checked, verified, {
				...context,
				sortMode: 'scan-coverage-desc'
			})
		).toBeLessThan(0);
		expect(
			compareSources(checked, verified, {
				...context,
				sortMode: 'coverage-desc'
			})
		).toBeGreaterThan(0);
	});
});
