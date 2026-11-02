import type { DataSource, EntityManager } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	archiveFailureSummarySchema,
	archiveFailureSummarySourceStateSql,
	archiveFailureSummaryDigestSql,
	isArchiveFailureSummaryRootRevision
} from '../KnownArchiveFailureSummaryVersion.js';
import { refreshNextKnownArchiveFailureSummary } from '../KnownArchiveFailureSummaryRefresh.js';
import {
	legacyArchiveFailureSummarySnapshotReadSql,
	readKnownArchiveFailureSummarySnapshots
} from '../KnownArchiveFailureSummarySnapshot.js';
import { emptyArchiveFailureSummary } from '../KnownArchiveFailureSummaryValue.js';

function managerFixture() {
	const connection = mock<DataSource>();
	return mock<EntityManager>({ connection });
}

describe('failure-summary rollout and revision guards', () => {
	it('preserves bigint revision strings without Number coercion', () => {
		expect(isArchiveFailureSummaryRootRevision('90071992547409931234')).toBe(true);
		expect(isArchiveFailureSummaryRootRevision('-1')).toBe(true);
		for (const invalid of [1, '-2', '1e3', '1.0', '', null])
			expect(isArchiveFailureSummaryRootRevision(invalid)).toBe(false);
	});

	it('validates aliases before producing compact-metadata SQL', () => {
		for (const invalid of ['root;drop table x', 'Root', '', 'a.b']) {
			expect(() => archiveFailureSummarySourceStateSql(invalid)).toThrow();
			expect(() => archiveFailureSummaryDigestSql(invalid)).toThrow();
		}
		expect(archiveFailureSummarySourceStateSql('root')).not.toContain(
			'history_archive_object_queue'
		);
	});

	it('caches an incomplete schema for one second only, then detects activation', async () => {
		const manager = managerFixture();
		manager.query.mockResolvedValueOnce([{ snapshotReady: true, versionedReady: false }]);
		manager.query.mockResolvedValueOnce([{ snapshotReady: true, versionedReady: true }]);
		expect((await archiveFailureSummarySchema(manager, 0)).versionedReady).toBe(false);
		expect((await archiveFailureSummarySchema(manager, 999)).versionedReady).toBe(false);
		expect(manager.query).toHaveBeenCalledTimes(1);
		expect((await archiveFailureSummarySchema(manager, 1000)).versionedReady).toBe(true);
		expect((await archiveFailureSummarySchema(manager, 300999)).versionedReady).toBe(true);
		expect(manager.query).toHaveBeenCalledTimes(2);
	});

	it('does not share schema readiness across data-source identities', async () => {
		const first = managerFixture();
		const second = managerFixture();
		first.query.mockResolvedValue([{ snapshotReady: true, versionedReady: true }]);
		second.query.mockResolvedValue([]);
		expect((await archiveFailureSummarySchema(first, 0)).versionedReady).toBe(true);
		expect(await archiveFailureSummarySchema(second, 0)).toEqual({
			snapshotReady: false, versionedReady: false
		});
	});

	it('does not select or aggregate raw evidence before migration readiness', async () => {
		const manager = managerFixture();
		manager.query.mockResolvedValue([{ snapshotReady: true, versionedReady: false }]);
		const database = mock<DataSource>({ manager });
		const load = jest.fn(async () => emptyArchiveFailureSummary(new Date()));
		expect(await refreshNextKnownArchiveFailureSummary(database, load)).toBeNull();
		expect(database.query).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
	});

	it('uses only legacy columns before activation and keeps last-good stale data', async () => {
		const manager = managerFixture();
		const computedAt = new Date('2026-10-01T00:00:00Z');
		const summary = emptyArchiveFailureSummary(computedAt);
		manager.query.mockResolvedValueOnce([{ snapshotReady: true, versionedReady: false }]);
		manager.query.mockResolvedValueOnce([{
			archiveUrlIdentity: 'root', summary, lastErrorCode: '57014'
		}]);
		const result = await readKnownArchiveFailureSummarySnapshots(
			manager, ['root', 'root'], new Date(computedAt.getTime() + 1)
		);
		expect(manager.query).toHaveBeenLastCalledWith(
			legacyArchiveFailureSummarySnapshotReadSql, [['root']]
		);
		expect(result.get('root')).toEqual({ ...summary, status: 'stale' });
		expect(legacyArchiveFailureSummarySnapshotReadSql).not.toContain('sourceRootRevision');
	});

	it('returns unavailable without querying a missing snapshot table', async () => {
		const manager = managerFixture();
		manager.query.mockResolvedValueOnce([{ snapshotReady: false, versionedReady: false }]);
		expect((await readKnownArchiveFailureSummarySnapshots(manager, ['root'])).size).toBe(0);
		expect(manager.query).toHaveBeenCalledTimes(1);
	});
});
