import { fetchArchiveInventorySnapshot } from '@api/archive-inventory-server';
import { GET } from '../route';

jest.mock('@api/archive-inventory-server', () => ({
	fetchArchiveInventorySnapshot: jest.fn()
}));

describe('stable archive inventory GET', () => {
	afterEach(() => jest.restoreAllMocks());
	it('returns a cacheable successful snapshot without a Server Action', async () => {
		const snapshot = {
			summary: { archiveEvidenceFailures: 149209 },
			nodes: [],
			organizations: []
		};
		jest
			.mocked(fetchArchiveInventorySnapshot)
			.mockResolvedValue(
				snapshot as Awaited<ReturnType<typeof fetchArchiveInventorySnapshot>>
			);
		const response = await GET();
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain(
			'stale-if-error=3600'
		);
		expect(await response.json()).toEqual(snapshot);
	});
	it('returns a bounded unavailable response instead of throwing a render error', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {});
		jest
			.mocked(fetchArchiveInventorySnapshot)
			.mockRejectedValue(new Error('private upstream details'));
		const response = await GET();
		expect(response.status).toBe(503);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: 'Archive inventory temporarily unavailable'
		});
	});
});
