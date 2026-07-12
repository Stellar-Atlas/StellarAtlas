import { formatCanonicalEvidenceSelection } from '../canonical-history-copy';

describe('canonical history copy', () => {
	it('describes proof provenance without implying total scanner coverage', () => {
		expect(formatCanonicalEvidenceSelection(1)).toBe(
			'canonical evidence selected from 1 verified archive root'
		);
		expect(formatCanonicalEvidenceSelection(2)).toBe(
			'canonical evidence selected from 2 verified archive roots'
		);
	});
});
