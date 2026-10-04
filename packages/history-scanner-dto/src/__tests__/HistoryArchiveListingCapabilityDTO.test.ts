import { isHistoryArchiveListingCapabilityDTO } from '../HistoryArchiveListingCapabilityDTO.js';
describe('listing capability hints', () => {
	it.each(['supported', 'unsupported', 'inconclusive'])(
		'accepts %s without any absence claim',
		(status) => {
			expect(
				isHistoryArchiveListingCapabilityDTO({
					status,
					observedAt: '2026-10-04T05:00:00Z'
				})
			).toBe(true);
		}
	);
	it.each([
		null,
		{},
		{ status: 'missing', observedAt: '2026-10-04T05:00:00Z' },
		{ status: 'supported', observedAt: 'bad' }
	])('rejects invalid hint %p', (value) => {
		expect(isHistoryArchiveListingCapabilityDTO(value)).toBe(false);
	});
});
