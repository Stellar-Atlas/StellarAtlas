import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveSharedBucketSetShadowMigration1788494000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1788494000000-HistoryArchiveSharedBucketSetShadowMigration.js';
import { HistoryArchiveSharedCheckpointBackfillMigration1788495000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1788495000000-HistoryArchiveSharedCheckpointBackfillMigration.js';
import {
	backfillSharedCheckpointContentPage,
	inspectSharedCheckpointBackfill
} from '@history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveSharedCheckpointContentBackfill.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('shared checkpoint content backfill', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: [HistoryArchiveObject],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveSharedBucketSetShadowMigration1788494000000().up(
			queryRunner
		);
		await new HistoryArchiveSharedCheckpointBackfillMigration1788495000000().up(
			queryRunner
		);
		await queryRunner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate table history_archive_checkpoint_content_conflict'
		);
		await dataSource.query(
			'truncate table history_archive_checkpoint_bucket_set cascade'
		);
		await dataSource.query(
			'truncate table history_archive_object_queue restart identity cascade'
		);
		await dataSource.query(
			`update history_archive_shared_checkpoint_backfill_progress
			 set "lastQueueId" = 0, "scannedRows" = 0,
			     "eligibleRows" = 0, "materializedRows" = 0,
			     "startedAt" = now(), "updatedAt" = now(),
			     "completedAt" = null`
		);
	});

	it('caps dense pages by eligible checkpoint count', async () => {
		const checkpoints = Array.from({ length: 150 }, (_, index) =>
			checkpointObject(`https://archive-${index}.example`)
		);
		await dataSource.getRepository(HistoryArchiveObject).save(checkpoints);

		const firstPage = await backfillSharedCheckpointContentPage(
			dataSource,
			1_000,
			100,
			100
		);
		expect(firstPage).toMatchObject({
			complete: false,
			eligibleRows: 100,
			materializedRows: 100,
			scannedRows: 100
		});

		const secondPage = await backfillSharedCheckpointContentPage(
			dataSource,
			1_000,
			100,
			100
		);
		expect(secondPage).toMatchObject({
			complete: false,
			eligibleRows: 50,
			materializedRows: 50,
			scannedRows: 50
		});
	});

	it('scans once by queue cursor and stores shared content idempotently', async () => {
		const first = checkpointObject('https://first.example/archive');
		const second = checkpointObject('https://second.example/archive');
		const ledger = new HistoryArchiveObject({
			archiveUrl: 'https://first.example/archive',
			archiveUrlIdentity: 'https://first.example/archive',
			checkpointLedger: 127,
			objectKey: 'ledger:0000007f',
			objectOrder: 1,
			objectType: 'ledger',
			objectUrl: 'https://first.example/archive/ledger.xdr.gz',
			status: 'verified'
		});
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([first, second, ledger]);

		const firstPage = await backfillSharedCheckpointContentPage(
			dataSource,
			1_000,
			100
		);
		expect(firstPage).toMatchObject({
			complete: false,
			eligibleRows: 2,
			materializedRows: 2,
			scannedRows: 3
		});

		const finalPage = await backfillSharedCheckpointContentPage(
			dataSource,
			1_000,
			100
		);
		expect(finalPage).toMatchObject({
			complete: true,
			eligibleRows: 0,
			materializedRows: 0,
			scannedRows: 0
		});

		const status = await inspectSharedCheckpointBackfill(dataSource);
		expect(status.observationRows).toBe(2);
		expect(status.conflictRows).toBe(0);
		expect(status.completedAt).not.toBeNull();
		await expect(
			countRows('history_archive_checkpoint_bucket_dependency_shared')
		).resolves.toBe(2);
	});

	async function countRows(table: string): Promise<number> {
		const [row] = (await dataSource.query(
			`select count(*)::integer as count from "${table}"`
		)) as readonly { readonly count: number }[];
		return row?.count ?? 0;
	}
});

function checkpointObject(archiveUrl: string): HistoryArchiveObject {
	const checkpoint = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: 127,
		objectKey: 'checkpoint-state:0000007f',
		objectOrder: 0,
		objectType: 'checkpoint-state',
		objectUrl: `${archiveUrl}/history/00/00/00/history-0000007f.json`,
		status: 'verified'
	});
	checkpoint.verificationFacts = {
		checkpointHistoryArchiveState: {
			stellarHistory: {
				currentBuckets: [
					{
						curr: 'a'.repeat(64),
						next: { output: '0'.repeat(64) },
						snap: '0'.repeat(64)
					}
				],
				hotArchiveBuckets: []
			}
		},
		checkpointHistoryArchiveStateFact: {
			bucketListHash: Buffer.alloc(32, 7).toString('base64'),
			checkpointLedger: 127,
			observedAt: new Date(0).toISOString(),
			stellarHistoryUrl: checkpoint.objectUrl
		},
		content: {
			algorithm: 'sha256',
			digest: 'd'.repeat(64),
			representation: 'canonical-json'
		}
	};
	checkpoint.verifiedAt = new Date();
	return checkpoint;
}
