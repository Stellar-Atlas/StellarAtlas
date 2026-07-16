import { historyArchiveObjectStaleReleaseSql } from '../HistoryArchiveObjectLeaseWrite.js';

describe('HistoryArchiveObjectLeaseWrite', () => {
	it('allows only one API worker to perform a stale-release pass', () => {
		expect(historyArchiveObjectStaleReleaseSql).toContain(
			'pg_try_advisory_xact_lock'
		);
		expect(historyArchiveObjectStaleReleaseSql).toContain(
			"hashtext('history_archive_object_stale_release')"
		);
		expect(historyArchiveObjectStaleReleaseSql).toContain(
			'where maintenance_guard.locked'
		);
	});
});
