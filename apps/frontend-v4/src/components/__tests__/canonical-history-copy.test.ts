import { formatCanonicalEvidenceSelection } from '../canonical-history-copy';

describe('canonical history copy', () => {
	it('describes proof provenance without implying total scanner coverage', () => {
		expect(formatCanonicalEvidenceSelection(1)).toBe(
			'1 verified archive root contributed to this canonical range'
		);
		expect(formatCanonicalEvidenceSelection(2)).toBe(
			'2 verified archive roots contributed to this canonical range'
		);
		for (const count of [1, 2])
			expect(formatCanonicalEvidenceSelection(count)).not.toMatch(
				/all archives|total scanner|complete (?:chain )?history/i
			);
	});
});
