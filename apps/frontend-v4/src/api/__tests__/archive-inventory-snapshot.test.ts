import {
	archiveInventoryRefreshFailed,
	type ArchiveInventorySnapshot
} from '../archive-inventory-snapshot';

describe('archive inventory refresh failure', () => {
	it('retains the previous snapshot and all source error evidence', () => {
		const snapshot = {
			summary: { archiveEvidenceFailures: 149209 }
		} as ArchiveInventorySnapshot;
		const next = archiveInventoryRefreshFailed({ snapshot, error: null });
		expect(next.snapshot).toBe(snapshot);
		expect(next.snapshot?.summary.archiveEvidenceFailures).toBe(149209);
		expect(next.error).toContain('last successful snapshot');
	});
	it('does not fabricate zero errors or successful coverage without a snapshot', () => {
		const next = archiveInventoryRefreshFailed({ snapshot: null, error: null });
		expect(next.snapshot).toBeNull();
		expect(next.error).toContain('does not indicate');
	});
});
