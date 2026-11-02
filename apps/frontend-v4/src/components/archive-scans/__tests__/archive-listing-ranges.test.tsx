import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveListingRanges } from '../archive-listing-ranges';
import type { ArchiveSource } from '../archive-inventory-model';

describe('archive listing ranges', () => {
	it('describes provider listing evidence and retains range, kind, and observation time', () => {
		const html = renderToStaticMarkup(
			<ArchiveListingRanges
				source={
					{
						listingGapCount: 1,
						listingGapRanges: [
							{
								firstCheckpointLedger: 640,
								lastCheckpointLedger: 703,
								checkpointCount: 1,
								observedAt: '2026-10-13T12:34:56.000Z',
								kind: 'missing-file'
							}
						]
					} as unknown as ArchiveSource
				}
			/>
		);
		expect(html).toContain(
			'Provider listings omit the required checkpoint filenames within this range.'
		);
		expect(html).toContain(
			'These are listing observations, not individual HTTP failures.'
		);
		expect(html).toContain('Ledger 640–703');
		expect(html).toContain('missing file');
		expect(html).toContain('Observed 2026-10-13T12:34:56.000Z');
	});
});
