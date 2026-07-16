import { FullHistoryCanonicalError } from '../../../../domain/full-history/FullHistoryCanonicalError.js';
import { assertFullHistoryInsertedCount } from '../FullHistoryCanonicalInsertCount.js';

describe('assertFullHistoryInsertedCount', () => {
	it.each([3, '3'])('accepts an exact inserted row count: %s', (insertedCount) => {
		expect(() =>
			assertFullHistoryInsertedCount([{ insertedCount }], 3, 'fixture')
		).not.toThrow();
	});

	it.each([
		{ rows: [], expectedCount: 1 },
		{ rows: [{ insertedCount: 0 }], expectedCount: 1 },
		{ rows: [{ insertedCount: 'invalid' }], expectedCount: 1 }
	])('rejects an incomplete or invalid insert proof', ({ rows, expectedCount }) => {
		expect(() =>
			assertFullHistoryInsertedCount(rows, expectedCount, 'fixture')
		).toThrow(
			expect.objectContaining<Partial<FullHistoryCanonicalError>>({
				reason: 'canonical-row-conflict'
			})
		);
	});
});
