import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { HistoryArchiveSchedulerOnlineIndexesMigration1784810000000 } from '../../../database/migrations/1784810000000-HistoryArchiveSchedulerOnlineIndexesMigration.js';
import { historyArchiveObjectFrontierSql } from '../HistoryArchiveObjectFrontierSql.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';

const describeScale =
	process.env.RUN_ARCHIVE_SCALE_TESTS === '1' ? describe : describe.skip;
const continuationBound = 'checkpoint-state:0007a120';
const pendingRows = 1_000_000;
const rootCount = 79;
const wrapBound = 'checkpoint-state:00000000';

jest.setTimeout(360_000);

describeScale('history archive execution reconciliation scale', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [
				HistoryArchiveCheckpointProof,
				HistoryArchiveObject,
				HistoryArchiveObjectEvent
			],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		try {
			await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
				queryRunner
			);
			await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
				queryRunner
			);
			await createCanonicalFrontierTestSchema(dataSource);
			await seedQueue(dataSource);
			await seedCheckpointCursors(dataSource);
			await new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000().up(
				queryRunner
			);
		} finally {
			await queryRunner.release();
		}
		await dataSource.query(
			'analyze history_archive_object_frontier_cursor, history_archive_object_queue'
		);
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('uses bounded index probes to refill and wrap the production frontier', async () => {
		const plan = await explainFrontier(dataSource);
		const planRecords = collectPlanRecords(plan);
		const identityScans = planRecords.filter((record) =>
			String(record['Index Name'] ?? '')
				.toLowerCase()
				.includes('history_archive_object_identity')
		);
		expect(
			planRecords.some(
				(record) =>
					record['Relation Name'] === 'history_archive_checkpoint_proof'
			)
		).toBe(false);
		expect(identityScans.length).toBeGreaterThan(0);
		expect(
			identityScans.some(
				(record) =>
					record['Scan Direction'] === 'Backward' &&
					/objectKey.*<.*cursor.*objectKey/.test(
						String(record['Index Cond'] ?? '')
					)
			)
		).toBe(true);
		expect(
			identityScans.every((record) => Number(record['Plan Width']) < 200)
		).toBe(true);
		expect(readTotalCost(plan)).toBeLessThan(100_000);

		const continuationStartedAt = performance.now();
		const continuation = await repository.reconcileExecutionDisposition();
		const continuationMs = performance.now() - continuationStartedAt;
		expect(continuation).toMatchObject({
			admittedObjects: 48,
			cursorAdvances: rootCount,
			outstandingObjects: 0,
			watermark: 48
		});
		expect(await readAdmissions(dataSource, '<', continuationBound)).toEqual({
			admitted: 48,
			allKeysMatch: true,
			roots: 48
		});

		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified'
			where status = 'pending'
				and "executionDisposition" = 'executable'
				and "executionReason" = 'frontier-admitted'
		`);
		await dataSource.query(
			`update "history_archive_object_frontier_cursor"
			 set "objectKey" = $1
			 where "objectType" = 'checkpoint-state'`,
			[wrapBound]
		);

		const wrapStartedAt = performance.now();
		const wrapped = await repository.reconcileExecutionDisposition();
		const wrapMs = performance.now() - wrapStartedAt;
		expect(wrapped).toMatchObject({
			admittedObjects: 48,
			cursorAdvances: rootCount,
			outstandingObjects: 0,
			watermark: 48
		});
		expect(await readAdmissions(dataSource, '>', wrapBound)).toEqual({
			admitted: 48,
			allKeysMatch: true,
			roots: 48
		});

		const metrics = {
			continuationMs: round(continuationMs),
			pendingRows,
			planCost: readTotalCost(plan),
			rootCount,
			wrapMs: round(wrapMs)
		};
		console.info(
			'ARCHIVE_EXECUTION_RECONCILIATION_SCALE_METRICS',
			JSON.stringify(metrics)
		);
		expect(metrics.continuationMs).toBeLessThan(5_000);
		expect(metrics.wrapMs).toBeLessThan(5_000);
	});
});

async function seedQueue(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`
			insert into "history_archive_object_queue" (
				"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
				"objectType", "objectKey", "objectOrder", "objectUrl", status,
				"dependencyReady", "createdAt", "updatedAt"
			)
			select gen_random_uuid(), archive_url, archive_url, host_identity,
				'history-archive-state', 'root', 0,
				archive_url || '/.well-known/stellar-history.json', 'verified',
				true, now(), now()
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
	for (let first = 1; first <= pendingRows; first += batchSize) {
		const last = Math.min(pendingRows, first + batchSize - 1);
		await dataSource.query(
			`
				insert into "history_archive_object_queue" (
					"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
					"objectType", "objectKey", "objectOrder", "objectUrl", status,
					"checkpointLedger", "dependencyReady", "executionDisposition",
					"createdAt", "updatedAt"
				)
				select gen_random_uuid(), archive_url, archive_url, host_identity,
					'checkpoint-state',
					'checkpoint-state:' || lpad(to_hex(item), 8, '0'), 10,
					archive_url || '/history/' || item || '.json', 'pending',
					(item * 64 + 63)::integer, null, null, now(), now()
				from (
					select item,
						'https://archive-' || (item % $1::integer) ||
							'.example/history' as archive_url,
						'archive-' || (item % $1::integer) || '.example' as host_identity
					from generate_series($2::integer, $3::integer) item
				) pending
			`,
			[rootCount, first, last]
		);
	}
}

async function seedCheckpointCursors(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`insert into "history_archive_object_frontier_cursor" (
			"archiveUrlIdentity", "objectType", "objectKey"
		 )
		 select "archiveUrlIdentity", 'checkpoint-state', $1
		 from "history_archive_object_queue"
		 where "objectType" = 'history-archive-state' and "objectKey" = 'root'`,
		[continuationBound]
	);
}

async function explainFrontier(dataSource: DataSource): Promise<unknown> {
	const [row] = (await dataSource.query(
		`explain (format json) ${historyArchiveObjectFrontierSql}`,
		[48, 8]
	)) as readonly { readonly 'QUERY PLAN': unknown }[];
	return row?.['QUERY PLAN'];
}

async function readAdmissions(
	dataSource: DataSource,
	operator: '<' | '>',
	bound: string
): Promise<{ admitted: number; allKeysMatch: boolean; roots: number }> {
	const [row] = (await dataSource.query(
		`select count(*)::integer as admitted,
			count(distinct "archiveUrlIdentity")::integer as roots,
			bool_and("objectKey" ${operator} $1) as "allKeysMatch"
		 from "history_archive_object_queue"
		 where status = 'pending'
			and "executionDisposition" = 'executable'
			and "executionReason" = 'frontier-admitted'`,
		[bound]
	)) as readonly {
		readonly admitted: number;
		readonly allKeysMatch: boolean;
		readonly roots: number;
	}[];
	if (row === undefined) throw new Error('Missing admission count');
	return row;
}

function collectPlanRecords(
	value: unknown
): readonly Record<string, unknown>[] {
	const records: Record<string, unknown>[] = [];
	visit(value, (record) => records.push(record));
	return records;
}

function readTotalCost(value: unknown): number {
	if (!Array.isArray(value) || !isRecord(value[0])) return Infinity;
	const plan = value[0]['Plan'];
	return isRecord(plan) ? Number(plan['Total Cost']) : Infinity;
}

function visit(
	value: unknown,
	callback: (record: Record<string, unknown>) => void
): void {
	if (Array.isArray(value)) {
		for (const child of value) visit(child, callback);
		return;
	}
	if (!isRecord(value)) return;
	callback(value);
	for (const child of Object.values(value)) visit(child, callback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
