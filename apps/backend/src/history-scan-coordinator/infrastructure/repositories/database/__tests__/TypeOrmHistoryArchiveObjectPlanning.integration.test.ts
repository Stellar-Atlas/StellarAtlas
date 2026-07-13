import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { HistoryArchiveObjectEventMigration1784370000000 } from '../../../database/migrations/1784370000000-HistoryArchiveObjectEventMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('history archive producer watermarks in disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveObject],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
			queryRunner
		);
		await new HistoryArchiveObjectEventMigration1784370000000().up(queryRunner);
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			queryRunner
		);
		await queryRunner.release();
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate "history_archive_object_event", "history_archive_object_plan", "history_archive_object_queue" restart identity cascade'
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('stabilizes 100 repeated 79-root producer passes at the idle watermark', async () => {
		const plans = createProductionPlans(79);

		for (let cycle = 0; cycle < 100; cycle += 1) {
			await repository.planObjects(plans);
			await repository.promotePlannedObjects();
		}

		const [counts] = (await dataSource.query(`
			select
				(select count(*)::integer from history_archive_object_queue)
					as queued,
				(select count(*)::integer from history_archive_object_plan)
					as planned,
				(select max(count)::integer from (
					select count(*) from history_archive_object_queue
					group by "archiveUrlIdentity"
				) roots) as "maxPerRoot"
		`)) as readonly {
			readonly maxPerRoot: number;
			readonly planned: number;
			readonly queued: number;
		}[];

		expect(counts).toEqual({ maxPerRoot: 1, planned: 110, queued: 48 });
		expect(counts.queued + counts.planned).toBe(79 * 2);
	});

	it('keeps the runnable queue bounded when measured throughput is high', async () => {
		const plans = createProductionPlans(300);
		await repository.planObjects(plans);
		await dataSource.query(`
			insert into "history_archive_object_event" (
				"objectRemoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
				"objectKey", "objectUrl", "eventType", "createdAt"
			)
			select
				gen_random_uuid(), 'https://throughput.example/archive',
				'https://throughput.example/archive', 'checkpoint-state',
				'checkpoint-state:throughput',
				'https://throughput.example/archive/checkpoint', 'verified', now()
			from generate_series(1, 300)
		`);

		const promotion = await repository.promotePlannedObjects();

		expect(promotion).toMatchObject({
			promotedObjects: 48,
			recentCompletions: 300,
			watermark: 48
		});
	});

	it('requeues only root state objects whose refresh window is due', async () => {
		const dueUrl = 'https://refresh-due.example/history';
		const freshUrl = 'https://refresh-fresh.example/history';
		const due = rootObject(dueUrl, 'verified');
		const fresh = rootObject(freshUrl, 'verified');
		due.refreshAfter = new Date(Date.now() - 60_000);
		due.verifiedAt = new Date(Date.now() - 10 * 60_000);
		fresh.refreshAfter = new Date(Date.now() + 60_000);
		fresh.verifiedAt = new Date();
		await dataSource.getRepository(HistoryArchiveObject).save([due, fresh]);

		await expect(
			repository.planObjects([rootObject(dueUrl), rootObject(freshUrl)])
		).resolves.toBe(1);

		await expect(
			dataSource.getRepository(HistoryArchiveObject).findOneByOrFail({
				archiveUrlIdentity: dueUrl,
				objectKey: 'root',
				objectType: 'history-archive-state'
			})
		).resolves.toMatchObject({ status: 'pending', verifiedAt: null });
		await expect(
			dataSource.getRepository(HistoryArchiveObject).findOneByOrFail({
				archiveUrlIdentity: freshUrl,
				objectKey: 'root',
				objectType: 'history-archive-state'
			})
		).resolves.toMatchObject({ status: 'verified' });
	});
});

function rootObject(
	archiveUrl: string,
	status: HistoryArchiveObject['status'] = 'pending'
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status
	});
}

function createProductionPlans(
	rootCount: number
): readonly HistoryArchiveObject[] {
	return Array.from({ length: rootCount }, (_, index) => {
		const archiveUrl = `https://archive-${index}.example/history`;
		return [
			new HistoryArchiveObject({
				archiveUrl,
				archiveUrlIdentity: archiveUrl,
				objectKey: 'root',
				objectOrder: 0,
				objectType: 'history-archive-state',
				objectUrl: `${archiveUrl}/.well-known/stellar-history.json`
			}),
			new HistoryArchiveObject({
				archiveUrl,
				archiveUrlIdentity: archiveUrl,
				checkpointLedger: 1_000_063,
				dependencyReady: true,
				objectKey: 'checkpoint-state:000f427f',
				objectOrder: 10,
				objectType: 'checkpoint-state',
				objectUrl: `${archiveUrl}/history/00/0f/42/history-000f427f.json`
			})
		];
	}).flat();
}
