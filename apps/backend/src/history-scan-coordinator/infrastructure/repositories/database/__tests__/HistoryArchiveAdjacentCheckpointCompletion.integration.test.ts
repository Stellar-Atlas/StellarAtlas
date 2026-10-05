import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { publicNetworkPassphrase } from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveStateRepository } from '../../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../../../use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { CompleteHistoryArchiveObject } from '../../../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { HistoryArchiveReadyPriorityLaneMigration1785460000000 } from '../../../database/migrations/1785460000000-HistoryArchiveReadyPriorityLaneMigration.js';
import { HistoryArchiveReadyParallelismMigration1785560000000 } from '../../../database/migrations/1785560000000-HistoryArchiveReadyParallelismMigration.js';
import { adjacentCheckpointPrefetchSql } from '../HistoryArchiveAdjacentCheckpointPrefetch.js';
import { historyArchiveRetainedRemoteFindingSql } from '../HistoryArchiveRetainedRemoteFindingSql.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { historyArchiveObjectOpenSequentialCohortSql } from '../HistoryArchiveSequentialChainSql.js';
import { createProofDataSource } from './HistoryArchiveCheckpointProofFixture.js';
import { createRoot } from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('accepted adjacent checkpoint completion', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource: db } = await createProofDataSource(postgres.url));
		const runner = db.createQueryRunner();
		await new HistoryArchiveReadyPriorityLaneMigration1785460000000().up(
			runner
		);
		await new HistoryArchiveReadyParallelismMigration1785560000000().up(runner);
		await runner.query(historyArchiveRetainedRemoteFindingSql);
		await runner.release();
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('fans out a fenced future state without advancing the missing predecessor or proving the checkpoint', async () => {
		const root = createRoot(0);
		root.hostIdentity = new URL(root.archiveUrl).hostname;
		await db.getRepository(HistoryArchiveObject).save(root);
		await db.query(
			`insert into history_archive_state_snapshot
			("archiveUrlIdentity",status,"currentLedger") values($1,'available',255)`,
			[root.archiveUrlIdentity]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor
			("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger")
			values($1,255,127)`,
			[root.archiveUrlIdentity]
		);
		const before = await db.query(
			'select * from history_archive_checkpoint_scan_cursor'
		);
		expect(
			await db.query(adjacentCheckpointPrefetchSql(), [
				[root.archiveUrlIdentity],
				4,
				128,
				null
			])
		).toEqual([{ planned: 3, ready: 3 }]);
		const repository = new TypeOrmHistoryArchiveObjectRepository(
			db.getRepository(HistoryArchiveObject)
		);
		const future = await db
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({
				archiveUrlIdentity: root.archiveUrlIdentity,
				objectType: 'checkpoint-state',
				checkpointLedger: 191
			});
		const executionId = randomUUID();
		await db.query(
			`update history_archive_object_ready
			set "dispatchToken"=$2,"claimAttempt"=1,"publishedAt"=now()
			where "objectRemoteId"=$1`,
			[future.remoteId, executionId]
		);
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		const useCase = new CompleteHistoryArchiveObject(
			repository,
			mock<HistoryArchiveStateRepository>(),
			mock<HistoryArchiveObjectEventRecorder>(),
			proofRepository
		);
		const bucketHash = 'a'.repeat(64);
		const request = {
			claimAttempt: 1,
			executionId,
			scheduler: 'broker' as const,
			workerStage: 'verified',
			verificationFacts: {
				content: {
					algorithm: 'sha256' as const,
					digest: 'c'.repeat(64),
					representation: 'canonical-json' as const
				},
				checkpointHistoryArchiveStateFact: {
					checkpointLedger: 191,
					bucketListHash: 'b'.repeat(64),
					observedAt: new Date().toISOString(),
					stellarHistoryUrl: future.objectUrl,
					networkPassphrase: publicNetworkPassphrase
				},
				checkpointHistoryArchiveState: {
					observedAt: new Date().toISOString(),
					stellarHistoryUrl: future.objectUrl,
					stellarHistory: {
						currentLedger: 191,
						networkPassphrase: publicNetworkPassphrase,
						server: 'stellar-core',
						version: 1,
						currentBuckets: [
							{ curr: bucketHash, next: { state: 0 }, snap: '0'.repeat(64) }
						]
					}
				}
			}
		};
		expect(
			(
				await useCase.execute(future.remoteId, {
					...request,
					executionId: randomUUID()
				})
			)._unsafeUnwrap()
		).toBe(false);
		expect((await repository.findByRemoteId(future.remoteId))?.status).toBe(
			'pending'
		);
		expect(
			(await useCase.execute(future.remoteId, request))._unsafeUnwrap()
		).toBe(true);
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			if (
				(await repository.findByRemoteId(future.remoteId))
					?.descendantsPlannedAt !== null
			)
				break;
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
		}
		expect(await repository.findByRemoteId(future.remoteId)).toMatchObject({
			status: 'verified',
			attempts: 1,
			descendantsPlannedAt: expect.any(Date),
			dependenciesMaterializedAt: expect.any(Date)
		});
		const children = await db.query(
			`select object."objectType",object.status,object.attempts,
			object."checkpointLedger",object."dependencyReady",ready.priority,
			${historyArchiveObjectOpenSequentialCohortSql('object')} as "inCohort"
			from history_archive_object_queue object
			join history_archive_object_ready ready on ready."objectRemoteId"=object."remoteId"
			where object."archiveUrlIdentity"=$1 and object."checkpointLedger"=191
			order by object."objectType"`,
			[root.archiveUrlIdentity]
		);
		expect(children).toEqual(
			['bucket', 'ledger', 'results', 'transactions'].map((objectType) => ({
				objectType,
				status: 'pending',
				attempts: 0,
				checkpointLedger: 191,
				dependencyReady: true,
				priority: 1,
				inCohort: true
			}))
		);
		expect(
			await db.query('select * from history_archive_checkpoint_scan_cursor')
		).toEqual(before);
		expect(
			await db.query('select 1 from history_archive_checkpoint_proof')
		).toEqual([]);
		expect(
			await db.query('select 1 from history_archive_checkpoint_substitution')
		).toEqual([]);
		expect(proofRepository.refreshForObject).not.toHaveBeenCalled();
		expect(
			await db.query(
				'select 1 from history_archive_object_ready where "objectRemoteId"=$1',
				[future.remoteId]
			)
		).toEqual([]);
	});
});
