import { access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	findVerifiedHistoryArchiveBucketSources,
	getHistoryArchiveRepairPlanSummary,
	historyArchiveRepairPlanSummarySql,
	historyArchiveVerifiedBucketSourcesSql
} from '../HistoryArchiveRepairPlanQuery.js';

jest.setTimeout(180_000);

const archiveUrlIdentity = 'https://repair-target.example';
const bucketCount = 500;
const irrelevantObjectCount = 1_000_000;
const sourceLimit = 5;

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

	it('keeps exact counts and 500 attributed bucket probes within bounded plans', async () => {
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

		const bucketHashes = Array.from({ length: bucketCount }, (_, index) =>
			(index + 1).toString(16).padStart(64, '0')
		);
		const sourcesStartedAt = performance.now();
		const sources = await findVerifiedHistoryArchiveBucketSources(
			dataSource.manager,
			bucketHashes,
			sourceLimit
		);
		const sourcesMs = performance.now() - sourcesStartedAt;
		expect(sources).toHaveLength(bucketCount * sourceLimit);
		expect(
			sources.every((source) => source.objectUrl.includes(source.bucketHash))
		).toBe(true);
		expect(
			sources
				.filter((source) => source.bucketHash === bucketHashes[0])
				.map((source) => source.archiveUrlIdentity)
		).toEqual(
			Array.from(
				{ length: sourceLimit },
				(_, index) =>
					`https://source-${String(index + 1).padStart(2, '0')}.example`
			)
		);

		const summaryPlan = await explain(
			dataSource,
			historyArchiveRepairPlanSummarySql,
			[archiveUrlIdentity]
		);
		const sourcePlan = await explain(
			dataSource,
			historyArchiveVerifiedBucketSourcesSql,
			[bucketHashes, sourceLimit]
		);
		const summaryRelations = readRelations(summaryPlan);
		const queueNodes = readRelationNodes(
			sourcePlan,
			'history_archive_object_queue'
		);
		expect(summaryRelations).not.toContain('history_archive_object_queue');
		expect(queueNodes.length).toBeGreaterThan(0);
		expect(queueNodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(
			false
		);
		expect(
			queueNodes.some((node) =>
				['Index Scan', 'Bitmap Heap Scan'].includes(node['Node Type'] ?? '')
			)
		).toBe(true);
		process.stdout.write(
			`ARCHIVE_REPAIR_PLAN_SCALE ${JSON.stringify({ irrelevantObjectCount, sourcePlan: summarizePlan(sourcePlan), sourcesMs: Number(sourcesMs.toFixed(3)), summaryMs: Number(summaryMs.toFixed(3)), summaryPlan: summarizePlan(summaryPlan) })}\n`
		);

		expect(summaryMs).toBeLessThan(500);
		expect(sourcesMs).toBeLessThan(5_000);
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

function readRelationNodes(
	plan: QueryPlan,
	relationName: string
): readonly QueryPlanNode[] {
	const nodes: QueryPlanNode[] = [];
	visitPlan(plan.Plan, (node) => {
		if (node['Relation Name'] === relationName) nodes.push(node);
	});
	return nodes;
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
	await source.query(bucketSourceFixtureSql, [bucketCount]);
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

const bucketSourceFixtureSql = `
		insert into history_archive_object_queue (
			"archiveUrl", "archiveUrlIdentity", "objectType", "objectKey",
			"objectUrl", status, "verificationFacts", "verifiedAt", "updatedAt"
		)
	select
		'https://source-' || lpad(source_index::text, 2, '0') || '.example',
		'https://source-' || lpad(source_index::text, 2, '0') || '.example',
		'bucket',
		'bucket:' || lpad(to_hex(bucket_index), 64, '0'),
		'https://source-' || lpad(source_index::text, 2, '0')
			|| '.example/bucket-' || lpad(to_hex(bucket_index), 64, '0'),
			case when source_index <= 8 then 'verified' else 'failed' end,
			jsonb_build_object(
				'bucketObject', jsonb_build_object(
					'expectedBucketHash', lpad(to_hex(bucket_index), 64, '0'),
					'matched', true,
					'sourceUrl', 'https://source-' ||
						lpad(source_index::text, 2, '0') ||
						'.example/bucket-' ||
						lpad(to_hex(bucket_index), 64, '0')
				),
				'content', jsonb_build_object(
					'algorithm', 'sha256',
					'digest', lpad(to_hex(bucket_index), 64, '0'),
					'representation', 'uncompressed-xdr'
				)
			),
			case when source_index <= 8 then now() else null end,
		now() - source_index * interval '1 second'
	from generate_series(1, $1::integer) bucket_index
	cross join generate_series(1, 11) source_index
`;
