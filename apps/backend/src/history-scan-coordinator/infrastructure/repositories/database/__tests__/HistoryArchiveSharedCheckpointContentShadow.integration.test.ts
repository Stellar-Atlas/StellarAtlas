import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveSharedBucketSetShadowMigration1788494000000 } from '@history-scan-coordinator/infrastructure/database/migrations/1788494000000-HistoryArchiveSharedBucketSetShadowMigration.js';
import { writeHistoryArchiveSharedCheckpointContentShadow } from '@history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveSharedCheckpointContentShadow.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('shared checkpoint content shadow storage', () => {
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
	});

	it('stores identical checkpoint content once without conflating next-output differences', async () => {
		const sharedCurrentHash = 'a'.repeat(64);
		const sharedNextHash = 'b'.repeat(64);
		const differentNextHash = 'c'.repeat(64);
		const sharedContentDigest = 'd'.repeat(64);
		const differentContentDigest = 'e'.repeat(64);
		const sharedBucketListHash = Buffer.alloc(32, 7).toString('base64');
		const first = checkpointObject(
			'https://first.example/archive',
			sharedCurrentHash,
			sharedNextHash,
			sharedContentDigest,
			sharedBucketListHash
		);
		const second = checkpointObject(
			'https://second.example/archive',
			sharedCurrentHash,
			sharedNextHash,
			sharedContentDigest,
			sharedBucketListHash
		);
		const third = checkpointObject(
			'https://third.example/archive',
			sharedCurrentHash,
			differentNextHash,
			differentContentDigest,
			sharedBucketListHash
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([first, second, third]);

		await writeHistoryArchiveSharedCheckpointContentShadow(
			dataSource.getRepository(HistoryArchiveObject),
			[first.remoteId, second.remoteId, third.remoteId]
		);
		await writeHistoryArchiveSharedCheckpointContentShadow(
			dataSource.getRepository(HistoryArchiveObject),
			[first.remoteId, second.remoteId, third.remoteId]
		);

		await expect(
			countRows('history_archive_checkpoint_bucket_set')
		).resolves.toBe(2);
		await expect(
			countRows('history_archive_checkpoint_bucket_set_member')
		).resolves.toBe(4);
		await expect(countRows('history_archive_checkpoint_content')).resolves.toBe(
			2
		);
		await expect(
			countRows('history_archive_checkpoint_content_observation')
		).resolves.toBe(3);
		await expect(
			countRows('history_archive_checkpoint_content_conflict')
		).resolves.toBe(0);
		const observations = (await dataSource.query(
			`select "contentDigest", count(*)::integer as count
			 from history_archive_checkpoint_content_observation
			 group by "contentDigest"
			 order by "contentDigest"`
		)) as readonly { readonly contentDigest: string; readonly count: number }[];
		expect(observations).toEqual([
			{ contentDigest: sharedContentDigest, count: 2 },
			{ contentDigest: differentContentDigest, count: 1 }
		]);
	});

	async function countRows(table: string): Promise<number> {
		const [row] = (await dataSource.query(
			`select count(*)::integer as count from "${table}"`
		)) as readonly { readonly count: number }[];
		return row?.count ?? 0;
	}
});

function checkpointObject(
	archiveUrl: string,
	currentHash: string,
	nextOutputHash: string,
	contentDigest: string,
	bucketListHash: string
): HistoryArchiveObject {
	const checkpoint = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: 127,
		objectKey: 'checkpoint-state:0000007f',
		objectOrder: 0,
		objectType: 'checkpoint-state',
		objectUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status: 'verified'
	});
	checkpoint.verificationFacts = {
		checkpointHistoryArchiveState: {
			stellarHistory: {
				currentBuckets: [
					{
						curr: currentHash,
						next: { output: nextOutputHash },
						snap: '0'.repeat(64)
					}
				],
				hotArchiveBuckets: []
			}
		},
		checkpointHistoryArchiveStateFact: {
			bucketListHash,
			checkpointLedger: 127,
			observedAt: new Date(0).toISOString(),
			stellarHistoryUrl: checkpoint.objectUrl
		},
		content: {
			algorithm: 'sha256',
			digest: contentDigest,
			representation: 'canonical-json'
		}
	};
	checkpoint.verifiedAt = new Date();
	return checkpoint;
}
