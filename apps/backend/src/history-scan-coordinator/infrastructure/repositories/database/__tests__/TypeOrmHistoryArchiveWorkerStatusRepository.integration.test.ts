import { DataSource } from 'typeorm';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveWorkerStatusRow } from '../../../database/entities/HistoryArchiveWorkerStatusRow.js';
import { HistoryArchiveWorkerStatusMigration1784790000000 } from '../../../database/migrations/1784790000000-HistoryArchiveWorkerStatusMigration.js';
import {
	historyArchiveWorkerRegistryLockTimeoutMs,
	historyArchiveWorkerStatusRegistryLockSql,
	TypeOrmHistoryArchiveWorkerStatusRepository
} from '../TypeOrmHistoryArchiveWorkerStatusRepository.js';

jest.setTimeout(60_000);

describe('TypeOrmHistoryArchiveWorkerStatusRepository ordering', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveWorkerStatusRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: [HistoryArchiveWorkerStatusRow],
			logging: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await new HistoryArchiveWorkerStatusMigration1784790000000().up(runner);
		await runner.release();
		repository = new TypeOrmHistoryArchiveWorkerStatusRepository(
			dataSource.getRepository(HistoryArchiveWorkerStatusRow)
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query('truncate table "history_archive_worker_status"');
	});

	it('rejects out-of-order equal-time reports and accepts a newer generation', async () => {
		const heartbeatAt = new Date('2026-07-10T12:00:00.000Z');
		await repository.report(createReport({ sequence: 2 }), heartbeatAt);
		await repository.report(
			createReport({ sequence: 1, stage: 'fetching_bucket' }),
			heartbeatAt
		);

		let [row] = await readRows();
		expect(row).toMatchObject({
			processGeneration: 0,
			sequence: 2,
			stage: 'downloading_bucket'
		});

		await repository.report(
			createReport({
				bytesDownloaded: null,
				claimAttempt: null,
				currentObject: null,
				processGeneration: 1,
				processId: 'd64e8132-2825-431a-a54b-10fe91ac324f',
				sequence: 1,
				stage: 'idle'
			}),
			heartbeatAt
		);

		[row] = await readRows();
		expect(row).toMatchObject({
			processGeneration: 1,
			processId: 'd64e8132-2825-431a-a54b-10fe91ac324f',
			sequence: 1,
			stage: 'idle'
		});
	});

	it('uses process identity as a deterministic equal-start tie-break', async () => {
		const heartbeatAt = new Date('2026-07-10T12:00:00.000Z');
		const lowerProcess = createReport({ sequence: 99 });
		const higherProcess = createReport({
			processId: 'd64e8132-2825-431a-a54b-10fe91ac324f',
			sequence: 1,
			stage: 'fetching_bucket'
		});

		await repository.report(higherProcess, heartbeatAt);
		await repository.report(lowerProcess, heartbeatAt);
		let [row] = await readRows();
		expect(row).toMatchObject({
			processId: higherProcess.processId,
			sequence: 1,
			stage: 'fetching_bucket'
		});

		await dataSource.query('truncate table "history_archive_worker_status"');
		await repository.report(lowerProcess, heartbeatAt);
		await repository.report(higherProcess, heartbeatAt);
		[row] = await readRows();
		expect(row).toMatchObject({
			processId: higherProcess.processId,
			sequence: 1,
			stage: 'fetching_bucket'
		});
	});

	it('hides stopped reporters at the public cutoff and prunes them on reads', async () => {
		await repository.report(
			createReport(),
			new Date('2026-07-10T11:40:00.000Z')
		);

		await expect(readRows()).resolves.toEqual([]);
		await expect(countRows()).resolves.toBe(1);
		await repository.findRecent({
			limit: 128,
			observedAfter: new Date('2026-07-10T11:45:00.000Z'),
			pruneBefore: new Date('2026-07-10T11:45:00.000Z')
		});
		await expect(countRows()).resolves.toBe(0);
	});

	it('enforces the registry cap atomically across concurrent reporters', async () => {
		const heartbeatAt = new Date('2026-07-10T12:00:00.000Z');
		await Promise.all(
			Array.from({ length: 160 }, (_, index) =>
				repository.report(
					createReport({
						processId: indexedUuid(index),
						workerId: `object-host-${index.toString()}-0`
					}),
					heartbeatAt
				)
			)
		);

		await expect(countRows()).resolves.toBe(128);
		await expect(readRows()).resolves.toHaveLength(128);
	});

	it('bounds advisory-lock contention and accepts the retry after release', async () => {
		const blocker = dataSource.createQueryRunner();
		await blocker.connect();
		await blocker.startTransaction();
		await blocker.query(historyArchiveWorkerStatusRegistryLockSql);
		const startedAt = Date.now();

		try {
			await expect(
				repository.report(createReport(), new Date())
			).rejects.toThrow(/lock timeout/i);
			expect(Date.now() - startedAt).toBeLessThan(
				historyArchiveWorkerRegistryLockTimeoutMs + 4_000
			);
			await blocker.rollbackTransaction();
			await expect(
				repository.report(createReport(), new Date())
			).resolves.toBeUndefined();
		} finally {
			if (blocker.isTransactionActive) await blocker.rollbackTransaction();
			await blocker.release();
		}
	});

	async function readRows() {
		return repository.findRecent({
			limit: 128,
			observedAfter: new Date('2026-07-10T11:45:00.000Z'),
			pruneBefore: new Date('2026-07-09T12:00:00.000Z')
		});
	}

	async function countRows(): Promise<number> {
		const [row] = (await dataSource.query(
			'select count(*)::int as count from "history_archive_worker_status"'
		)) as readonly { readonly count: number }[];
		return row?.count ?? 0;
	}
});

function createReport(
	overrides: Partial<HistoryArchiveWorkerReportDTO> = {}
): HistoryArchiveWorkerReportDTO {
	return {
		bytesDownloaded: 1024,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket'
		},
		lastOutcome: 'none',
		lastOutcomeAt: null,
		pid: 4123,
		processGeneration: 0,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T11:00:00.000Z',
		sequence: 1,
		stage: 'downloading_bucket',
		workerId: 'object-host-0-0',
		...overrides
	};
}

function indexedUuid(index: number): string {
	return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
