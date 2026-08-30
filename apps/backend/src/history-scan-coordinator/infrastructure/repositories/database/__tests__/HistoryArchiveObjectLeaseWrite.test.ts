import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveObjectVerifiedBatchSql,
	historyArchiveObjectStaleReleaseSql,
	touchHistoryArchiveObjectClaim
} from '../HistoryArchiveObjectLeaseWrite.js';

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

	it('locks broker-ready completion rows in dispatcher order before deleting', () => {
		const readyLock = historyArchiveObjectVerifiedBatchSql.indexOf(
			'broker_ready_lockable as materialized'
		);
		const readyDelete =
			historyArchiveObjectVerifiedBatchSql.indexOf(
				'broker_ready_removed as'
			);

		expect(readyLock).toBeGreaterThan(-1);
		expect(readyDelete).toBeGreaterThan(readyLock);
		expect(historyArchiveObjectVerifiedBatchSql).toContain(
			'order by ready."objectRemoteId"\n                for update of ready'
		);
	});

	it('uses returned rows instead of the structured update tuple as heartbeat evidence', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([[], 0])
			.mockResolvedValueOnce([[{ slot: 7 }], 1]);
		const repository = {
			manager: { query }
		} as unknown as Repository<HistoryArchiveObject>;

		await expect(
			touchHistoryArchiveObjectClaim(
				repository,
				'00000000-0000-4000-8000-000000000001',
				2
			)
		).resolves.toBe(false);
		await expect(
			touchHistoryArchiveObjectClaim(
				repository,
				'00000000-0000-4000-8000-000000000002',
				3
			)
		).resolves.toBe(true);
	});
});
