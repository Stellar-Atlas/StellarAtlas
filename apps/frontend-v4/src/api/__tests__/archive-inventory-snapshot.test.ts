import {
	archiveInventoryRefreshFailed,
	archiveInventoryRefreshSucceeded,
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

describe('archive inventory refresh ordering', () => {
	const snapshot = (
		generatedAt: string,
		failures: number
	): ArchiveInventorySnapshot =>
		({
			summary: { generatedAt, archiveEvidenceFailures: failures }
		}) as ArchiveInventorySnapshot;
	it('does not replace a newer page snapshot with an older cached API response', () => {
		const previous = {
			snapshot: snapshot('2026-09-05T19:40:00Z', 149545),
			error: null
		};
		expect(
			archiveInventoryRefreshSucceeded(
				previous,
				snapshot('2026-09-05T19:39:00Z', 149528)
			)
		).toBe(previous);
	});
	it('accepts a newer result even when successful retries reduce failure counts', () => {
		const previous = {
			snapshot: snapshot('2026-09-05T19:40:00Z', 149545),
			error: 'Refresh failed'
		};
		const incoming = snapshot('2026-09-05T19:41:00Z', 149500);
		expect(archiveInventoryRefreshSucceeded(previous, incoming)).toEqual({
			snapshot: incoming,
			error: null
		});
	});
	it('retains evidence if the incoming snapshot timestamp is invalid', () => {
		const previous = {
			snapshot: snapshot('2026-09-05T19:40:00Z', 149545),
			error: null
		};
		const result = archiveInventoryRefreshSucceeded(
			previous,
			snapshot('invalid', 0)
		);
		expect(result.snapshot).toBe(previous.snapshot);
		expect(result.error).toContain('last successful snapshot');
	});
});
