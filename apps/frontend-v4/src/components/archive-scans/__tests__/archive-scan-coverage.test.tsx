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
	it('shows full verified total and distinct scan union without summing overlap', () => {
		const html = renderToStaticMarkup(
			<ArchiveScanCoverage source={{ ...root, scanCoverage: coverage }} />
		);
		expect(html).toContain('3 / 10 checkpoint positions verified');
		expect(html).toContain('70.00% scanned');
		expect(html).toContain('7 positions');
		expect(html).toContain('width:40%');
		expect(html).toContain('width:30%');
		expect(html).toContain('4 positions covered by listing evidence');
		expect(html).not.toContain('5 checked');
		expect(html).not.toContain('90.00%');
	});
	it('keeps confirmed listing ranges visible during partial reconciliation', () => {
		const html = renderToStaticMarkup(
			<ArchiveScanCoverage
				source={{
					...root,
					scanCoverage: { ...coverage, status: 'reconciling' }
				}}
			/>
		);
		expect(html).toContain('≥70.00% scanned');
		expect(html).toContain('width:40%');
	});
	it('does not replace 94,965 verified positions with a partially seeded 208 checks', () => {
		const source = {
			...root,
			currentLedger: 6399999,
			latestCheckpointLedger: 6399999,
			latestDiscoveredCheckpointLedger: 6399999,
			durableVerifiedCheckpointProofs: 94965,
			scanCoverage: {
				...coverage,
				checkedCheckpointPositions: 208,
				scannedCheckpointPositions: 208,
				listingCoveredCheckpointPositions: 0,
				status: 'reconciling' as const
			}
		};
		expect(getKnownScannedPositions(source)).toBe(94965);
		const html = renderToStaticMarkup(<ArchiveScanCoverage source={source} />);
		expect(html).toContain('94,965 / 100,000 checkpoint positions verified');
		expect(html).not.toContain('208');
		expect(html).not.toContain('listing');
		expect(html).not.toContain('Historical count reconciling');
		expect(html).not.toContain('≥');
	});
	it('does not count untouched proof queue rows as scans', () => {
		expect(
			getKnownScannedPositions({
				...root,
				totalCheckpointProofs: 10,
				pendingCheckpointProofs: 7
			} as ArchiveSource)
		).toBe(3);
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
