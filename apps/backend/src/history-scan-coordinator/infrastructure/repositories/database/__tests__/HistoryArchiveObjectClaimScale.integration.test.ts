import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { HistoryArchiveSchedulerOnlineIndexesMigration1784810000000 } from '../../../database/migrations/1784810000000-HistoryArchiveSchedulerOnlineIndexesMigration.js';
import {
	historyArchiveObjectClaimAdoptionSql,
	historyArchiveObjectClaimCleanupSql,
	historyArchiveObjectClaimFinalizeSql,
	historyArchiveObjectClaimSelectionSql
} from '../HistoryArchiveObjectClaimSql.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const describeScale =
	process.env.RUN_ARCHIVE_SCALE_TESTS === '1' ? describe : describe.skip;
const queueRows = 1_000_079;
const rootCount = 79;
const executableRows = 240;

jest.setTimeout(360_000);

describeScale('history archive claim scale', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;
	let indexBuildMs = 0;
	let executableIndexBytes = 0;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveObject, HistoryArchiveObjectEvent],
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
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			queryRunner
		);
		await seedQueue(dataSource);
		const indexStartedAt = performance.now();
		await new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000().up(
			queryRunner
		);
		indexBuildMs = performance.now() - indexStartedAt;
		const [indexSize] = (await dataSource.query(
			`select pg_relation_size(
					'idx_history_archive_object_executable_claim'
				)::bigint as bytes`
		)) as readonly { readonly bytes: number | string }[];
		executableIndexBytes = Number(indexSize?.bytes ?? 0);
		await queryRunner.release();
		await dataSource.query('analyze history_archive_object_queue');
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('uses index seeks and serves 24 workers within the acceptance budget', async () => {
		const plan = await explainClaim(dataSource);
		expect(findQueueSequentialScans(plan)).toEqual([]);

		const sequentialMs: number[] = [];
		for (let attempt = 0; attempt < 25; attempt += 1) {
			const startedAt = performance.now();
			const claim = await repository.claimNextObject(['checkpoint-state']);
			sequentialMs.push(performance.now() - startedAt);
			if (claim === null) throw new Error('Expected scale claim');
			await repository.releaseObject(claim.remoteId, claim.attempts);
		}

		const concurrentStartedAt = performance.now();
		const concurrentClaims = await Promise.all(
			Array.from({ length: 24 }, () =>
				repository.claimNextObject(['checkpoint-state'])
			)
		);
		const concurrentMs = performance.now() - concurrentStartedAt;
		const claimedIds = concurrentClaims.flatMap((claim) =>
			claim === null ? [] : [claim.remoteId]
		);
		const metrics = {
			concurrent24Ms: round(concurrentMs),
			executableIndexBytes,
			executableRows,
			indexBuildMs: round(indexBuildMs),
			medianClaimMs: round(percentile(sequentialMs, 0.5)),
			p95ClaimMs: round(percentile(sequentialMs, 0.95)),
			queueRows,
			productionAssumptions: {
				consumers: 24,
				exactQueueRows: 31_009_646,
				freeDiskBytes: 18 * 1024 ** 3,
				plannerEstimatedRows: 2_000_000,
				queueRelationBytes: 33 * 1024 ** 3
			}
		};
		console.info('ARCHIVE_CLAIM_SCALE_METRICS', JSON.stringify(metrics));

		expect(claimedIds).toHaveLength(24);
		expect(new Set(claimedIds).size).toBe(24);
		expect(metrics.medianClaimMs).toBeLessThan(100);
		expect(metrics.p95ClaimMs).toBeLessThan(250);
		expect(metrics.concurrent24Ms).toBeLessThan(2000);
	});
});

async function seedQueue(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`
			insert into history_archive_object_queue (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl", status,
			"dependencyReady", "transitionEffectsCompletedAt", "createdAt", "updatedAt"
		)
		select
			gen_random_uuid(), archive_url, archive_url, host_identity,
			'history-archive-state', 'root', 0,
			archive_url || '/.well-known/stellar-history.json', 'verified',
			true, now(), now(), now()
		from (
			select
				'https://archive-' || root || '.example/history' as archive_url,
				'archive-' || root || '.example' as host_identity
			from generate_series(0, $1::integer - 1) root
		) roots
		`,
		[rootCount]
	);
	const batchSize = 100_000;
	for (let first = 1; first <= queueRows - rootCount; first += batchSize) {
		const last = Math.min(queueRows - rootCount, first + batchSize - 1);
		await dataSource.query(
			`
		insert into history_archive_object_queue (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl", status,
				"checkpointLedger", "dependencyReady", "executionDisposition",
				"createdAt", "updatedAt"
		)
		select
			gen_random_uuid(), archive_url, archive_url, host_identity,
			'checkpoint-state', 'checkpoint-state:' || item, 10,
			archive_url || '/history/' || item || '.json', 'pending',
			(item * 64 + 63)::integer, true, 'deferred', now(), now()
		from (
			select
				item,
				'https://archive-' || (item % $1::integer) || '.example/history'
					as archive_url,
				'archive-' || (item % $1::integer) || '.example' as host_identity
			from generate_series($2::integer, $3::integer) item
		) pending
		`,
			[rootCount, first, last]
		);
	}
	await dataSource.query(
		`with selected as (
			select id from history_archive_object_queue
			where status = 'pending'
			order by id
			limit $1
		)
		update history_archive_object_queue object
		set "executionDisposition" = 'executable'
		from selected where object.id = selected.id`,
		[executableRows]
	);
}

async function explainClaim(dataSource: DataSource): Promise<unknown> {
	const [root] = (await dataSource.query(`
		select id, "archiveUrlIdentity", "hostIdentity"
		from history_archive_object_queue
		where "objectType" = 'history-archive-state'
		order by id
		limit 1
	`)) as readonly {
		readonly archiveUrlIdentity: string;
		readonly hostIdentity: string;
		readonly id: number;
	}[];
	if (root === undefined) throw new Error('Expected a scale root');
	const statements: readonly (readonly [string, readonly unknown[]])[] = [
		[historyArchiveObjectClaimCleanupSql, [false]],
		[historyArchiveObjectClaimAdoptionSql, [24]],
		[historyArchiveObjectClaimSelectionSql, [['checkpoint-state'], 1, 24, 2]],
		[
			historyArchiveObjectClaimFinalizeSql,
			[
				['checkpoint-state'],
				1,
				0,
				2,
				root.id,
				root.archiveUrlIdentity,
				root.hostIdentity,
				'pending'
			]
		]
	];
	const plans: unknown[] = [];
	for (const [sql, parameters] of statements) {
		const [row] = (await dataSource.query(
			`explain (format json) ${sql}`,
			parameters
		)) as readonly { readonly 'QUERY PLAN': unknown }[];
		plans.push(row?.['QUERY PLAN']);
	}
	return plans;
}

function findQueueSequentialScans(value: unknown): readonly string[] {
	const matches: string[] = [];
	visit(value, (record) => {
		if (
			record['Node Type'] === 'Seq Scan' &&
			record['Relation Name'] === 'history_archive_object_queue'
		) {
			matches.push(String(record['Node Type']));
		}
	});
	return matches;
}

function visit(
	value: unknown,
	callback: (record: Record<string, unknown>) => void
): void {
	if (Array.isArray(value)) {
		for (const child of value) visit(child, callback);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	const record = value as Record<string, unknown>;
	callback(record);
	for (const child of Object.values(record)) visit(child, callback);
}

function percentile(
	values: readonly number[],
	percentileValue: number
): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor((sorted.length - 1) * percentileValue)] ?? Infinity;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
