import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { markHistoryArchiveObjectsVerified } from '../HistoryArchiveObjectLeaseWrite.js';
import { markHistoryArchiveObjectFailed } from '../HistoryArchiveObjectFailureWrite.js';
import { historyArchiveRetainedRemoteFindingSql } from '../HistoryArchiveRetainedRemoteFindingSql.js';
import {
	createObjectRepositoryDataSource,
	resetHistoryArchiveObjectQueue
} from './HistoryArchiveObjectRepositoryFixture.js';

jest.setTimeout(60_000);
const root = 'https://terminal.example/history';

describe('accepted terminal-result checkpoint scan hooks', () => {
	let db: DataSource;
	let pg: DisposablePostgres;
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		({ dataSource: db } = await createObjectRepositoryDataSource(pg.url));
		await db.query(historyArchiveRetainedRemoteFindingSql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await resetHistoryArchiveObjectQueue(db);
		await db.query(
			'truncate history_archive_retained_remote_finding, history_archive_retained_remote_summary'
		);
	});

	async function object(
		type: HistoryArchiveObject['objectType'],
		checkpoint: number | null
	) {
		const value = new HistoryArchiveObject({
			archiveUrl: root,
			archiveUrlIdentity: root,
			objectKey: `${type}:${checkpoint}`,
			objectType: type,
			checkpointLedger: checkpoint,
			objectOrder: 10,
			objectUrl: `${root}/${type}/${checkpoint}`,
			status: 'scanning'
		});
		value.attempts = 1;
		return db.getRepository(HistoryArchiveObject).save(value);
	}
	async function count() {
		return db.query(
			'select "checkedCheckpointPositions", "listingCoveredCheckpointPositions", "scannedCheckpointPositions" from history_archive_checkpoint_scan_summary where "archiveUrlIdentity"=$1',
			[root]
		);
	}

	it('counts only accepted categories once and excludes stale, root and incidental bucket checkpoints', async () => {
		const ledger = await object('ledger', 63);
		const transactions = await object('transactions', 63);
		const stale = await object('results', 127);
		const bucket = await object('bucket', 191);
		const state = await object('history-archive-state', 255);
		const result = await markHistoryArchiveObjectsVerified(
			db.getRepository(HistoryArchiveObject),
			[ledger, transactions, stale, bucket, state].map((row) => ({
				remoteId: row.remoteId,
				progress: { claimAttempt: row === stale ? 2 : 1 }
			}))
		);
		expect([...result].sort()).toEqual(
			[ledger, transactions, bucket, state].map((row) => row.remoteId).sort()
		);
		expect(await count()).toEqual([
			{
				checkedCheckpointPositions: '1',
				listingCoveredCheckpointPositions: '0',
				scannedCheckpointPositions: '1'
			}
		]);
		expect(
			await db.query(
				'select count(*)::integer as count from history_archive_object_event'
			)
		).toEqual([{ count: 0 }]);
	});

	it('counts accepted scanner failures as tried without relabeling them as source faults', async () => {
		const row = await object('checkpoint-state', 127);
		const failure = {
			claimAttempt: 1,
			errorType: 'scanner_configuration',
			errorMessage: 'worker cannot decode',
			failureChannel: 'scanner_issue' as const,
			httpStatus: null,
			nextAttemptAt: null
		};
		expect(
			await markHistoryArchiveObjectFailed(
				db.getRepository(HistoryArchiveObject),
				row.remoteId,
				{ ...failure, claimAttempt: 2 }
			)
		).toBe(false);
		expect(await count()).toEqual([]);
		expect(
			await markHistoryArchiveObjectFailed(
				db.getRepository(HistoryArchiveObject),
				row.remoteId,
				failure
			)
		).toBe(true);
		expect(
			await markHistoryArchiveObjectFailed(
				db.getRepository(HistoryArchiveObject),
				row.remoteId,
				failure
			)
		).toBe(false);
		expect(await count()).toEqual([
			{
				checkedCheckpointPositions: '1',
				listingCoveredCheckpointPositions: '0',
				scannedCheckpointPositions: '1'
			}
		]);
		expect(
			await db
				.getRepository(HistoryArchiveObject)
				.findOneByOrFail({ remoteId: row.remoteId })
		).toMatchObject({
			status: 'failed',
			failureChannel: 'scanner_issue',
			errorType: 'scanner_configuration'
		});
	});

	it('requires the actual broker execution token before recording coverage', async () => {
		const row = await object('scp', 63);
		await db
			.getRepository(HistoryArchiveObject)
			.update(row.id, { status: 'pending', attempts: 0 });
		const executionId = randomUUID();
		await db.query(
			'insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","dispatchToken","claimAttempt","publishedAt") values ($1,$2,2,now(),$3,1,now())',
			[row.remoteId, root, executionId]
		);
		const complete = (token: string) =>
			markHistoryArchiveObjectsVerified(
				db.getRepository(HistoryArchiveObject),
				[
					{
						remoteId: row.remoteId,
						progress: {
							scheduler: 'broker',
							executionId: token,
							claimAttempt: 1
						}
					}
				]
			);
		expect((await complete(randomUUID())).size).toBe(0);
		expect(await count()).toEqual([]);
		expect((await complete(executionId)).size).toBe(1);
		expect(await count()).toEqual([
			{
				checkedCheckpointPositions: '1',
				listingCoveredCheckpointPositions: '0',
				scannedCheckpointPositions: '1'
			}
		]);
	});

	it('rolls accepted terminal status and coverage back together if the surrounding transaction fails', async () => {
		const row = await object('checkpoint-state', 63);
		await expect(
			db.transaction(async (manager) => {
				await markHistoryArchiveObjectsVerified(
					manager.getRepository(HistoryArchiveObject),
					[{ remoteId: row.remoteId, progress: { claimAttempt: 1 } }]
				);
				throw new Error('reject transaction');
			})
		).rejects.toThrow('reject transaction');
		expect(await count()).toEqual([]);
		expect(
			(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: row.remoteId })
			).status
		).toBe('scanning');
	});
});
