import { access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	getHistoryArchiveRepairPlanSummary,
	historyArchiveRepairPlanSummarySql
} from '../HistoryArchiveRepairPlanQuery.js';

jest.setTimeout(180_000);

const archiveUrlIdentity = 'https://repair-target.example';
const irrelevantObjectCount = 1_000_000;

describe('history archive repair plan query scale', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createFixture(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) {
			const directory = postgres.dataDirectory;
			await postgres.stop();
			await expect(access(directory)).rejects.toThrow();
		}
	});

	it('keeps exact repair counts within a bounded rollup plan', async () => {
		const summaryStartedAt = performance.now();
		const summary = await getHistoryArchiveRepairPlanSummary(
			dataSource.manager,
			archiveUrlIdentity
		);
		const summaryMs = performance.now() - summaryStartedAt;
		expect(summary).toMatchObject({
			activeObjects: 1,
			failedCheckpointProofs: 4,
			failedObjects: 2,
			pendingObjects: 3,
			verifiedObjects: 5
		});
		expect(summary.hostThrottles).toHaveLength(1);

		const summaryPlan = await explain(
			dataSource,
			historyArchiveRepairPlanSummarySql,
			[archiveUrlIdentity]
		);
		const summaryRelations = readRelations(summaryPlan);
		expect(summaryRelations).not.toContain('history_archive_object_queue');
		process.stdout.write(
			`ARCHIVE_REPAIR_PLAN_SCALE ${JSON.stringify({ irrelevantObjectCount, summaryMs: Number(summaryMs.toFixed(3)), summaryPlan: summarizePlan(summaryPlan) })}\n`
		);

		expect(summaryMs).toBeLessThan(500);
	});
});

type QueryPlanNode = {
	readonly 'Actual Rows'?: number;
	readonly 'Node Type'?: string;
	readonly Plans?: readonly QueryPlanNode[];
	readonly 'Relation Name'?: string;
};

type QueryPlan = {
	readonly 'Execution Time'?: number;
	readonly Plan?: QueryPlanNode;
};

async function explain(
	source: DataSource,
	sql: string,
	parameters: readonly unknown[]
): Promise<QueryPlan> {
	const [row] = (await source.query(
		`explain (analyze, buffers, format json) ${sql}`,
		parameters
	)) as readonly { readonly 'QUERY PLAN': readonly QueryPlan[] }[];
	const plan = row?.['QUERY PLAN'][0];
	if (plan === undefined) throw new Error('PostgreSQL returned no query plan');
	return plan;
}

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
	visitPlan(plan.Plan, (node) => {
		if (node['Node Type'] !== undefined) nodes.push(node['Node Type']);
	});
	return {
		executionMs: plan['Execution Time'] ?? null,
		nodes,
		relations: readRelations(plan)
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

async function createFixture(source: DataSource): Promise<void> {
	await source.query(`
		create unlogged table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrl" text not null,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"objectKey" text not null,
				"objectUrl" text not null,
				status text not null,
				"verificationFacts" jsonb,
				"verifiedAt" timestamptz,
			"updatedAt" timestamptz not null default now()
		);
		create index idx_history_archive_object_key
			on history_archive_object_queue ("objectType", "objectKey");
		create table history_archive_evidence_root_summary (
			"archiveUrlIdentity" text primary key,
			"totalObjects" bigint not null,
			"pendingObjects" bigint not null,
			"activeObjects" bigint not null,
			"verifiedObjects" bigint not null
		);
		create table history_archive_evidence_root_summary_progress (
			id smallint primary key,
			"complete" boolean not null
		);
		create table history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity" text primary key,
			"mismatchCheckpointProofs" bigint not null
		);
		create table history_archive_checkpoint_proof_rollup_progress (
			id smallint primary key,
			"complete" boolean not null
		);
		create table history_archive_object_host_throttle (
			"archiveUrlIdentity" text not null,
			"blockedUntil" timestamptz not null,
			"consecutiveFailures" integer not null,
			"errorType" text not null,
			"evidenceClass" text not null,
			"failureClass" text not null,
			"hostIdentity" text not null,
			"httpStatus" integer,
			"lastFailureAt" timestamptz not null
		);
	`);
	await source.query(
		'insert into history_archive_evidence_root_summary values ($1, 11, 3, 1, 5)',
		[archiveUrlIdentity]
	);
	await source.query(
		'insert into history_archive_evidence_root_summary_progress values (1, true)'
	);
	await source.query(
		'insert into history_archive_checkpoint_proof_rollup values ($1, 4)',
		[archiveUrlIdentity]
	);
	await source.query(
		'insert into history_archive_checkpoint_proof_rollup_progress values (1, true)'
	);
	await source.query(hostThrottleFixtureSql, [archiveUrlIdentity]);
	await source.query(irrelevantObjectFixtureSql, [irrelevantObjectCount]);
	await source.query(targetObjectFixtureSql, [archiveUrlIdentity]);
	await source.query('analyze history_archive_object_queue');
}

const hostThrottleFixtureSql = `
	insert into history_archive_object_host_throttle values (
		$1, now() + interval '1 day', 2, 'WORKER_EACCES',
		'worker-infrastructure', 'worker', 'repair-target.example', null, now()
	)
`;

const irrelevantObjectFixtureSql = `
	insert into history_archive_object_queue (
		"archiveUrl", "archiveUrlIdentity", "objectType", "objectKey",
		"objectUrl", status
	)
	select
		'https://irrelevant.example', 'https://irrelevant.example', 'ledger',
		'ledger:' || lpad(to_hex(object_index), 16, '0'),
		'https://irrelevant.example/ledger/' || object_index, 'pending'
	from generate_series(1, $1::integer) object_index
`;

const targetObjectFixtureSql = `
	insert into history_archive_object_queue (
		"archiveUrl", "archiveUrlIdentity", "objectType", "objectKey",
		"objectUrl", status
	)
	select
		$1, $1, 'ledger', 'target:' || object_index,
		$1 || '/target/' || object_index,
		case
			when object_index <= 3 then 'pending'
			when object_index = 4 then 'scanning'
			when object_index <= 9 then 'verified'
			else 'failed'
		end
	from generate_series(1, 11) object_index
`;
