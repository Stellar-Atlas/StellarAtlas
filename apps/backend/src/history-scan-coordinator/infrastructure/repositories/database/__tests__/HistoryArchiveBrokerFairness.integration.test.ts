import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const rootA = 'https://a.example/history';
const rootB = 'https://b.example/history';
const rootC = 'https://c.example/history';

describe('broker per-root reservation rounds', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let repository: HistoryArchiveBrokerFrontierRepository;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key, "archiveUrlIdentity" text not null,
			priority smallint not null, "availableAt" timestamptz not null,
			"dispatchToken" uuid, "claimAttempt" integer, "publishedAt" timestamptz,
			"updatedAt" timestamptz not null
		)`);
		repository = new HistoryArchiveBrokerFrontierRepository(db);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query('truncate history_archive_object_ready');
		await resetKnownEvidence(db);
	});

	async function seed(
		root: string,
		checkpoints: readonly number[],
		priority = 2,
		host = new URL(root).host
	) {
		const objects = checkpoints.map((checkpoint) => {
			const object = createEvidenceObject(
				root,
				`ledger:${checkpoint.toString(16).padStart(8, '0')}`,
				'ledger',
				'pending'
			);
			object.checkpointLedger = checkpoint;
			object.hostIdentity = host;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId", "archiveUrlIdentity", priority, "availableAt", "updatedAt")
			select id, $2, $3, '2000-01-01Z', '2000-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((object) => object.remoteId), root, priority]
		);
		return objects;
	}

	it('reserves one job per root before a second round despite widely separated checkpoint positions', async () => {
		await seed(rootA, [63, 127, 191]);
		await seed(rootB, [6_400_063, 6_400_127]);
		await seed(rootC, [32_000_063]);
		const jobs = await repository.reserveJobs(3, 10);
		expect(
			jobs.map(({ job }) => [job.archiveUrl, job.checkpointLedger])
		).toEqual([
			[rootA, 63],
			[rootB, 6_400_063],
			[rootC, 32_000_063]
		]);
		expect(jobs.map((job) => job.selectedOrdinal)).toEqual([1, 2, 3]);
	});

	it('prioritizes interrupted rechecks but reserves at least half a mixed batch for new proofs', async () => {
		const retries = await seed(rootA, [63, 127, 191, 255], 2);
		await db.query(
			`update history_archive_object_queue set status = 'failed',
			"errorType" = 'ERR_CANCELED', "errorMessage" = 'aborted', "httpStatus" = 200,
			"failureChannel" = 'archive_evidence', "nextAttemptAt" = '2000-01-01Z'
			where "remoteId" = any($1::uuid[])`,
			[retries.map((o) => o.remoteId)]
		);
		await seed(rootB, [6_400_063, 6_400_127, 6_400_191, 6_400_255], 0);
		const jobs = await repository.reserveJobs(4, 10);
		expect(jobs.map(({ job }) => job.archiveUrl)).toEqual([
			rootB,
			rootB,
			rootA,
			rootA
		]);
		expect(jobs.filter(({ job }) => job.archiveUrl === rootA)).toHaveLength(2);
	});

	it('alternates single-slot mixed reservations without starving either lane', async () => {
		const retries = await seed(rootA, [63, 127, 191, 255]);
		await db.query(
			`update history_archive_object_queue set status = 'failed',
			"errorType" = 'ERR_CANCELED', "nextAttemptAt" = '2000-01-01Z'
			where "remoteId" = any($1::uuid[])`,
			[retries.map((o) => o.remoteId)]
		);
		await seed(rootB, [639, 703, 767, 831]);
		const roots: string[] = [];
		for (let index = 0; index < 4; index++) {
			const jobs = await repository.reserveJobs(1, 10);
			roots.push(jobs[0]!.job.archiveUrl);
		}
		expect(roots.filter((root) => root === rootA)).toHaveLength(2);
		expect(roots.filter((root) => root === rootB)).toHaveLength(2);
	});

	it('applies root rounds before the retry share budget', async () => {
		const a = await seed(rootA, [63, 127, 191, 255]);
		const b = await seed(rootB, [639, 703, 767, 831]);
		await db.query(
			`update history_archive_object_queue set status = 'failed',
			"errorType" = 'ECONNRESET', "nextAttemptAt" = '2000-01-01Z'
			where "remoteId" = any($1::uuid[])`,
			[[...a, ...b].map((o) => o.remoteId)]
		);
		await seed(rootC, [1279, 1343, 1407, 1471]);
		const jobs = await repository.reserveJobs(4, 10);
		expect(jobs.map(({ job }) => job.archiveUrl)).toEqual([
			rootA,
			rootB,
			rootC,
			rootC
		]);
	});

	it('can use otherwise idle capacity for rechecks without a second worker pool', async () => {
		const retries = await seed(rootA, [63, 127, 191, 255]);
		await db.query(
			`update history_archive_object_queue set status = 'failed',
			"errorType" = 'ECONNRESET', "httpStatus" = null,
			"nextAttemptAt" = '2000-01-01Z' where "remoteId" = any($1::uuid[])`,
			[retries.map((o) => o.remoteId)]
		);
		expect(await repository.reserveJobs(4, 10)).toHaveLength(4);
	});

	it('keeps each root oldest-first while interleaving later rounds', async () => {
		await seed(rootA, [191, 63, 127]);
		await seed(rootB, [6_400_127, 6_400_063]);
		const jobs = await repository.reserveJobs(5, 10);
		expect(
			jobs.map(({ job }) => [job.archiveUrl, job.checkpointLedger])
		).toEqual([
			[rootA, 63],
			[rootB, 6_400_063],
			[rootA, 127],
			[rootB, 6_400_127],
			[rootA, 191]
		]);
	});

	it('shares one host cap between roots without letting its lowest-ledger root consume every slot', async () => {
		await seed(rootA, [63, 127, 191], 2, 'shared.example');
		await seed(rootB, [6_400_063, 6_400_127], 2, 'shared.example');
		const jobs = await repository.reserveJobs(10, 2);
		expect(jobs.map(({ job }) => job.archiveUrl)).toEqual([rootA, rootB]);
	});

	it('counts existing published jobs against the same host cap', async () => {
		const [active] = await seed(
			'https://active.example/history',
			[63],
			2,
			'shared.example'
		);
		await db.query(
			'update history_archive_object_ready set "publishedAt" = now(), "dispatchToken" = gen_random_uuid(), "claimAttempt" = 1 where "objectRemoteId" = $1',
			[active!.remoteId]
		);
		await seed(rootA, [127, 191], 2, 'shared.example');
		await seed(rootB, [6_400_063], 2, 'shared.example');
		await seed(rootC, [32_000_063, 32_000_127]);
		const jobs = await repository.reserveJobs(10, 2);
		expect(jobs.filter(({ job }) => job.archiveUrl !== rootC)).toHaveLength(1);
		expect(jobs.filter(({ job }) => job.archiveUrl === rootC)).toHaveLength(2);
	});

	it('retains canonical and proof-completion priority ahead of generic root rounds', async () => {
		await seed(rootA, [63, 127], 2);
		await seed(rootB, [6_400_127, 6_400_063], 0);
		await seed(rootC, [32_000_063], 1);
		const jobs = await repository.reserveJobs(3, 10);
		expect(
			jobs.map(({ priority, job }) => [priority, job.checkpointLedger])
		).toEqual([
			[0, 6_400_063],
			[0, 6_400_127],
			[1, 32_000_063]
		]);
	});

	it('does not admit future, deferred, dependency-blocked, transitioning or throttled work', async () => {
		const blocked = await seed(rootA, [63, 127, 191, 255, 319]);
		await db.query(
			'update history_archive_object_ready set "availableAt" = now() + interval \'1 hour\' where "objectRemoteId" = $1',
			[blocked[0]!.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "executionDisposition" = \'deferred\' where "remoteId" = $1',
			[blocked[1]!.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "dependencyReady" = false where "remoteId" = $1',
			[blocked[2]!.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "transitionEffectsRequiredAt" = now(), "transitionEffectsCompletedAt" = null where "remoteId" = $1',
			[blocked[3]!.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "hostIdentity" = \'throttled.example\' where "remoteId" = $1',
			[blocked[4]!.remoteId]
		);
		await db.query(
			"insert into history_archive_object_host_throttle values ('throttled.example', now() + interval '1 hour')"
		);
		await seed(rootB, [6_400_063]);
		expect(
			(await repository.reserveJobs(10, 10)).map(({ job }) => job.archiveUrl)
		).toEqual([rootB]);
	});
});
