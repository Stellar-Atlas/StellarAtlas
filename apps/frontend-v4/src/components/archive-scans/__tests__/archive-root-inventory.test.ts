import {
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
});
