import { HistoryArchiveCheckpointProofRollupMigration1784830000000 } from '../1784830000000-HistoryArchiveCheckpointProofRollupMigration.js';
import {
	assertCheckpointProofRollupDiskAvailable,
	estimateCheckpointProofRollupDisk
} from '../HistoryArchiveCheckpointProofRollupDiskGuard.js';
import {
	checkpointProofRollupBatchBoundarySql,
	checkpointProofRollupBatchSelectSql,
	checkpointProofRollupBatchSize
} from '../../../repositories/database/HistoryArchiveCheckpointProofRollupSql.js';

describe('HistoryArchiveCheckpointProofRollupMigration', () => {
	it('uses transaction-free committed batches with bounded proof reads', () => {
		const migration =
			new HistoryArchiveCheckpointProofRollupMigration1784830000000();

		expect(migration.transaction).toBe(false);
		expect(checkpointProofRollupBatchSize).toBe(10_000);
		expect(checkpointProofRollupBatchBoundarySql).toContain('order by id');
		expect(checkpointProofRollupBatchBoundarySql).toContain('least(');
		expect(checkpointProofRollupBatchBoundarySql).not.toContain('id <=');
		expect(checkpointProofRollupBatchBoundarySql).toContain(
			'limit $3::integer'
		);
		expect(checkpointProofRollupBatchSelectSql).toContain('id > $1::bigint');
		expect(checkpointProofRollupBatchSelectSql).toContain('id <= $2::bigint');
		expect(checkpointProofRollupBatchSelectSql).not.toContain('group by');
	});

	it('keeps an eight-GiB root reserve and rejects insufficient peak space', () => {
		const estimate = estimateCheckpointProofRollupDisk(
			256n,
			checkpointProofRollupBatchSize
		);
		const seventeenGiB = 17n * 1024n * 1024n * 1024n;

		expect(estimate.rootReserveBytes).toBe(8n * 1024n * 1024n * 1024n);
		expect(estimate.estimatedFinalBytes).toBeLessThan(18n * 1024n * 1024n);
		expect(estimate.estimatedPeakBytes).toBeLessThan(128n * 1024n * 1024n);
		expect(() =>
			assertCheckpointProofRollupDiskAvailable(estimate, seventeenGiB)
		).not.toThrow();
		expect(() =>
			assertCheckpointProofRollupDiskAvailable(
				estimate,
				estimate.requiredFreeBytes - 1n
			)
		).toThrow('disk guard failed');
	});
});
