import { performance } from 'node:perf_hooks';
import { access } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProofRollupMigration1784830000000 } from '../../../database/migrations/1784830000000-HistoryArchiveCheckpointProofRollupMigration.js';
import {
	estimateCheckpointProofRollupDisk,
	type HistoryArchiveCheckpointProofRollupDiskEstimate
} from '../../../database/migrations/HistoryArchiveCheckpointProofRollupDiskGuard.js';
import {
	checkpointProofRollupBatchBoundarySql,
	checkpointProofRollupBatchSelectSql,
	checkpointProofRollupBatchSize
} from '../HistoryArchiveCheckpointProofRollupSql.js';
import { HistoryArchiveStatusSummaryIndexesMigration1784800000000 } from '../../../database/migrations/1784800000000-HistoryArchiveStatusSummaryIndexesMigration.js';
import { checkpointCoverageSql } from '../HistoryArchiveObjectCheckpointCoverageQuery.js';
import {
	evidenceHealthSql,
	getHistoryArchiveObjectStatusSummary,
	sourceCountSql,
	sourceStatusSummarySql
} from '../HistoryArchiveObjectStatusSummaryQuery.js';
import {
	createEvidenceSummarySchema,
	populateCheckpointProofScaleFixture,
	populateEvidenceSummary
} from './HistoryArchiveObjectStatusSummaryScaleFixture.js';

// Bulk-mounted initdb and fixture loading are intentionally outside the query
// latency assertions and can be slow under concurrent production I/O.
const scaleSetupTimeoutMs = 1_800_000;
jest.setTimeout(scaleSetupTimeoutMs);

const archiveCount = 100;
const checkpointsPerArchive = 10_000;
const expectedProofRows = archiveCount * checkpointsPerArchive;

describe('history archive status summary scale', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let rollupMigrationMs = 0;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		expect(postgres.dataDirectory).toMatch(
			/^\/home\/observe\/stellarbeat-data\/stellaratlas-postgres-/
		);
		dataSource = await connect(postgres.url);
		await createFixture(dataSource);
		await populateCheckpointProofScaleFixture(
			dataSource,
			archiveCount,
			checkpointsPerArchive
		);
		await createCheckpointProofFixtureIndexes(dataSource);
		await runIndexMigration(dataSource);
		rollupMigrationMs = await runRollupMigration(dataSource);
		await dataSource.destroy();
		await postgres.restart(120);
		dataSource = await connect(postgres.url);
	}, scaleSetupTimeoutMs);

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) {
			const directory = postgres.dataDirectory;
			await postgres.stop();
			await expect(access(directory)).rejects.toThrow();
		}
	});

	it('keeps cold and warm headline reads well below the latency budget', async () => {
		const coldMs = await measureSummary();
		const warmMs = await measureSummary();

		const coveragePlan = await explain(checkpointCoverageSql, [null]);
		const sourcePlan = await explain(sourceStatusSummarySql, [256]);
		const evidenceHealthPlan = await explain(evidenceHealthSql);
		const sourceCountPlan = await explain(sourceCountSql);
		const plans = [
			coveragePlan,
			sourcePlan,
			evidenceHealthPlan,
			sourceCountPlan
		];
		for (const plan of plans) {
			expect(readRelations(plan)).not.toContain(
				'history_archive_checkpoint_proof'
			);
		}

		const proofRows = await countProofRows();
		expect(proofRows).toBe(expectedProofRows);
		const boundaryPlan = await explain(checkpointProofRollupBatchBoundarySql, [
			0,
			expectedProofRows,
			checkpointProofRollupBatchSize
		]);
		const backfillPlan = await explain(backfillBatchAggregateSql, [
			0,
			checkpointProofRollupBatchSize,
			checkpointProofRollupBatchSize
		]);
		const boundaryPlanSummary = summarizePlan(boundaryPlan);
		const backfillPlanSummary = summarizePlan(backfillPlan);
		process.stdout.write(
			`ARCHIVE_ROLLUP_BATCH_PLAN ${JSON.stringify({ backfillPlanSummary, boundaryPlanSummary })}\n`
		);
		expect(boundaryPlanSummary.maxRows).toBeLessThanOrEqual(
			checkpointProofRollupBatchSize
		);
		expect(backfillPlanSummary.maxRows).toBeLessThanOrEqual(
			checkpointProofRollupBatchSize
		);
		expect(backfillPlanSummary.maxSortRows).toBeLessThanOrEqual(
			checkpointProofRollupBatchSize
		);
		expect(backfillPlanSummary.tempWrittenBlocks).toBe(0);
		expect(boundaryPlanSummary.tempWrittenBlocks).toBe(0);
		const disk = await readDiskFootprint(
			backfillPlanSummary.tempWrittenBlocks +
				boundaryPlanSummary.tempWrittenBlocks
		);
			const migrationDiskEstimate = estimateCheckpointProofRollupDisk(
				BigInt(archiveCount),
				checkpointProofRollupBatchSize
			);
		expect(BigInt(disk.finalAddedBytes)).toBeLessThanOrEqual(
			migrationDiskEstimate.estimatedFinalBytes
		);
		expect(disk.tempWrittenBytes).toBe(0);
		const planSummary = plans.map(summarizePlan);
		process.stdout.write(
			`ARCHIVE_STATUS_SUMMARY_SCALE ${JSON.stringify({ backfillPlanSummary, boundaryPlanSummary, coldMs, disk, migrationDiskEstimate: stringifyBigInts(migrationDiskEstimate), planSummary, proofRows, rollupMigrationMs, warmMs })}\n`
		);

		expect(coldMs).toBeLessThan(1_500);
		expect(warmMs).toBeLessThan(750);
	});

	async function countProofRows(): Promise<number> {
		const [row] = (await dataSource.query(`
			select count(*)::int as count
			from history_archive_checkpoint_proof
		`)) as readonly { readonly count: number }[];
		return row?.count ?? 0;
	}

	async function readDiskFootprint(tempWrittenBlocks: number) {
		const [row] = (await dataSource.query(`
			select
				pg_total_relation_size(
					'history_archive_checkpoint_proof'::regclass
				)::text as "proofBytes",
				pg_total_relation_size(
					'history_archive_checkpoint_proof_rollup'::regclass
				)::text as "rollupBytes",
				pg_total_relation_size(
					'history_archive_checkpoint_proof_rollup_state'::regclass
				)::text as "rollupStateBytes",
				pg_total_relation_size(
					'history_archive_checkpoint_proof_rollup_progress'::regclass
				)::text as "rollupProgressBytes",
				pg_relation_size(
					'idx_history_archive_object_root_summary'::regclass
				)::text as "rootIndexBytes"
		`)) as readonly {
			readonly proofBytes: string;
			readonly rollupBytes: string;
			readonly rollupProgressBytes: string;
			readonly rollupStateBytes: string;
			readonly rootIndexBytes: string;
		}[];
		if (row === undefined) throw new Error('PostgreSQL returned no size data');
		const proofBytes = Number(row.proofBytes);
		const rollupBytes = Number(row.rollupBytes);
		const rollupProgressBytes = Number(row.rollupProgressBytes);
		const rollupStateBytes = Number(row.rollupStateBytes);
		const rootIndexBytes = Number(row.rootIndexBytes);
		const finalAddedBytes =
			rollupBytes + rollupProgressBytes + rollupStateBytes + rootIndexBytes;
		return {
			finalAddedBytes,
			proofBytes,
			rollupBytes,
			rollupProgressBytes,
			rollupStateBytes,
			rootIndexBytes,
			tempWrittenBytes: tempWrittenBlocks * 8192
		};
	}

	async function explain(
		sql: string,
		parameters: readonly unknown[] = []
	): Promise<QueryPlan> {
		const [row] = (await dataSource.query(
			`explain (analyze, buffers, format json) ${sql}`,
			parameters
		)) as readonly { readonly 'QUERY PLAN': readonly QueryPlan[] }[];
		const plan = row?.['QUERY PLAN'][0];
		if (plan === undefined)
			throw new Error('PostgreSQL returned no query plan');
		return plan;
	}

	async function measureSummary(): Promise<number> {
		const startedAt = performance.now();
		const summary = await getHistoryArchiveObjectStatusSummary(
			dataSource.manager
		);
		expect(summary.activeObjectChecks).toBe(24);
		expect(summary.checkpointCoverage.activeArchiveCheckpoints).toBe(1);
		expect(summary.archiveEvidenceFailures).toBe(2);
		expect(summary.scannerIssueFailures).toBe(1);
		expect(summary.unclassifiedFailures).toBe(1);
		expect(summary.checkpointCoverage.totalArchiveCheckpoints).toBe(
			expectedProofRows
		);
		expect(summary.sources).toHaveLength(archiveCount);
		expect(
			summary.sources.find(
				(source) => source.rootFailureChannel === 'archive_evidence'
			)
		).toMatchObject({ rootObjectStatus: 'failed' });
		expect(
			summary.sources.reduce(
				(total, source) => total + source.archiveEvidenceFailures,
				0
			)
		).toBe(2);
		return Number((performance.now() - startedAt).toFixed(3));
	}
});

type QueryPlanNode = {
	readonly 'Actual Rows'?: number;
	readonly 'Actual Total Time'?: number;
	readonly 'Node Type'?: string;
	readonly Plans?: readonly QueryPlanNode[];
	readonly 'Relation Name'?: string;
	readonly 'Temp Written Blocks'?: number;
};

type QueryPlan = {
	readonly 'Execution Time'?: number;
	readonly Plan?: QueryPlanNode;
};

function readRelations(plan: QueryPlan): readonly string[] {
	const relations: string[] = [];
	visitPlan(plan.Plan, (node) => {
		if (node['Relation Name'] !== undefined) {
			relations.push(node['Relation Name']);
		}
	});
	return relations;
}

function summarizePlan(plan: QueryPlan) {
	const nodes: string[] = [];
	let maxRows = 0;
	let maxSortRows = 0;
	let tempWrittenBlocks = 0;
	visitPlan(plan.Plan, (node) => {
		if (node['Node Type'] !== undefined) nodes.push(node['Node Type']);
		maxRows = Math.max(maxRows, node['Actual Rows'] ?? 0);
		if (node['Node Type'] === 'Sort') {
			maxSortRows = Math.max(maxSortRows, node['Actual Rows'] ?? 0);
		}
		tempWrittenBlocks += node['Temp Written Blocks'] ?? 0;
	});
	return {
		executionMs: plan['Execution Time'] ?? null,
		maxRows,
		maxSortRows,
		nodes,
		relations: readRelations(plan),
		tempWrittenBlocks
	};
}

function visitPlan(
	node: QueryPlanNode | undefined,
	visit: (node: QueryPlanNode) => void
): void {
	if (node === undefined) return;
	visit(node);
	for (const child of node.Plans ?? []) visitPlan(child, visit);
}

async function connect(url: string): Promise<DataSource> {
	const dataSource = new DataSource({ type: 'postgres', url });
	await dataSource.initialize();
	return dataSource;
}

async function runRollupMigration(dataSource: DataSource): Promise<number> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	const startedAt = performance.now();
	try {
		await new HistoryArchiveCheckpointProofRollupMigration1784830000000().up(
			runner
		);
		return Number((performance.now() - startedAt).toFixed(3));
	} finally {
		await runner.release();
	}
}

async function runIndexMigration(dataSource: DataSource): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	try {
		await new HistoryArchiveStatusSummaryIndexesMigration1784800000000().up(
			runner
		);
	} finally {
		await runner.release();
	}
}

async function createFixture(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table history_archive_state_snapshot (
			"archiveUrl" text not null,
			"archiveUrlIdentity" text primary key,
			"stateUrl" text not null,
			status text not null,
			"observedAt" timestamptz not null,
			source text not null,
			"currentLedger" integer
		)
	`);
	await dataSource.query(`
		create table history_archive_object_queue (
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			status text not null,
			"checkpointLedger" integer,
			"failureChannel" text,
			"updatedAt" timestamptz not null
		)
	`);
	await createEvidenceSummarySchema(dataSource);
	await dataSource.query(`
		create index status_summary_queue_status
		on history_archive_object_queue (status)
	`);
	await dataSource.query(`
		create index status_summary_queue_roots
		on history_archive_object_queue ("archiveUrlIdentity", "updatedAt" desc)
		include (status) where "objectType" = 'history-archive-state'
	`);
	await dataSource.query(`
		create table history_archive_checkpoint_proof (
			id bigserial not null,
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			status text not null,
			"requiredObjectsComplete" boolean not null
		)
	`);
	await dataSource.query(fixtureInsertSql, [
		archiveCount,
		checkpointsPerArchive
	]);
	await populateEvidenceSummary(dataSource);
}

async function createCheckpointProofFixtureIndexes(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		alter table history_archive_checkpoint_proof
		add primary key (id),
		add unique ("archiveUrlIdentity", "checkpointLedger")
	`);
	await dataSource.query(`
		create index status_summary_proof_archive
		on history_archive_checkpoint_proof ("archiveUrlIdentity", status)
	`);
}

const fixtureInsertSql = `
	with archives as (
		select archive,
			'https://archive-' || archive || '.example' as identity
		from generate_series(1, $1::integer) archive
	),
	inserted_states as (
		insert into history_archive_state_snapshot (
			"archiveUrl", "archiveUrlIdentity", "stateUrl", status,
			"observedAt", source, "currentLedger"
		)
		select identity, identity, identity || '/.well-known/stellar-history.json',
			'available', now(), 'network-scan', ($2::integer * 64) - 1
		from archives
		returning "archiveUrlIdentity"
	),
	inserted_roots as (
		insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status, "failureChannel",
			"updatedAt"
		)
		select "archiveUrlIdentity", 'history-archive-state',
			case
				when ordinal <= 23 then 'scanning'
				when ordinal = 25 then 'failed'
				else 'verified'
			end,
			case when ordinal = 25 then 'archive_evidence' else null end,
			now()
		from (
			select "archiveUrlIdentity",
				row_number() over (order by "archiveUrlIdentity") as ordinal
			from inserted_states
		) ranked_states
		returning "archiveUrlIdentity"
	), inserted_active_checkpoint as (
		insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status, "checkpointLedger",
			"updatedAt"
		)
		select "archiveUrlIdentity", 'ledger', 'scanning', 63, now()
		from inserted_states
		order by "archiveUrlIdentity"
		limit 1
		returning "archiveUrlIdentity"
	), inserted_failures as (
		insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status, "checkpointLedger",
			"failureChannel", "updatedAt"
		)
		select "archiveUrlIdentity", 'ledger', 'failed', 63,
			case row_number() over (order by "archiveUrlIdentity")
				when 1 then 'archive_evidence'
				when 2 then 'scanner_issue'
				else null
			end,
			now()
		from inserted_states
		order by "archiveUrlIdentity"
		limit 3
		returning "archiveUrlIdentity"
	)
	select count(*) from inserted_failures
`;

const backfillBatchAggregateSql = `
	with batch as materialized (
		${checkpointProofRollupBatchSelectSql}
	)
	select "archiveUrlIdentity", count(*)
	from batch
	group by "archiveUrlIdentity"
`;

function stringifyBigInts(
	value: HistoryArchiveCheckpointProofRollupDiskEstimate
): Readonly<Record<string, string>> {
	return {
		archiveCount: value.archiveCount.toString(),
		estimatedFinalBytes: value.estimatedFinalBytes.toString(),
		estimatedPeakBytes: value.estimatedPeakBytes.toString(),
		requiredFreeBytes: value.requiredFreeBytes.toString(),
		rootReserveBytes: value.rootReserveBytes.toString()
	};
}
