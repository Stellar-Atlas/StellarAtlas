import {
	selectArchiveEvidence,
	statusUpdatesAreStale
} from '../status-live-freshness';

describe('status evidence freshness', () => {
	const fallback = { generatedAt: '2026-09-06T20:10:00Z', failures: 0 };
	const cached = { generatedAt: '2026-09-06T20:09:00Z', failures: 149102 };
	it('accepts genuine cached evidence older than an unavailable SSR placeholder', () => {
		expect(selectArchiveEvidence(fallback, false, cached)).toEqual({
			summary: cached,
			available: true
		});
	});
	it('rejects older evidence only after genuine evidence is available', () => {
		expect(selectArchiveEvidence(fallback, true, cached)).toEqual({
			summary: fallback,
			available: true
		});
	});
	it('does not establish availability from missing or invalid incoming timestamps', () => {
		expect(selectArchiveEvidence(fallback, false, undefined).available).toBe(
			false
		);
		expect(
			selectArchiveEvidence(fallback, false, {
				...cached,
				generatedAt: 'invalid'
			}).available
		).toBe(false);
	});
	it('accepts a newer summary, including reduced failures after recovery', () => {
		expect(selectArchiveEvidence(cached, true, fallback)).toEqual({
			summary: fallback,
			available: true
		});
	});
	it('marks the last valid payload stale at fifteen seconds', () => {
		expect(statusUpdatesAreStale(1000, 15999)).toBe(false);
		expect(statusUpdatesAreStale(1000, 16000)).toBe(true);
	});
});
