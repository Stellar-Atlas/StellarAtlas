import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	archiveObjectBucketHashIndexName,
	archiveObjectGlobalBucketHashIndexName,
	archiveObjectUniqueBucketHashStatementTimeoutMs,
	getExactUniqueBucketHashCount,
	uniqueBucketHashGlobalSql,
	uniqueBucketHashReadSettingsSql
} from '../HistoryArchiveObjectBucketSummaryQuery.js';
import { sourceSummarySql } from '../HistoryArchiveObjectSourceSummaryQuery.js';
import { objectTypeSummarySql } from '../HistoryArchiveObjectTypeSummaryReadQuery.js';

const archiveCount = 200;
const bucketRows = 200_000;
const uniqueBucketHashes = bucketRows / 2;

jest.setTimeout(180_000);

describe('HistoryArchiveObjectSummaryQuery scale plans', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createScaleFixture(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('keeps rollup reads off the queue and distinct hashes index-only', async () => {
		const objectTypePlan = await explainDataSource(
			dataSource,
			objectTypeSummarySql,
			[null]
		);
		const sourcePlan = await explainDataSource(dataSource, sourceSummarySql, [
			null
		]);
		for (const plan of [objectTypePlan, sourcePlan]) {
			const relations = readRelationAccesses(plan).map(
				(access) => access.relation
			);
			expect(relations).not.toContain('history_archive_object_queue');
			expect(relations).not.toContain('history_archive_checkpoint_proof');
		}

		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		let uniquePlan: QueryPlan;
		try {
			await runner.query(uniqueBucketHashReadSettingsSql, [
				archiveObjectGlobalBucketHashIndexName,
				`${archiveObjectUniqueBucketHashStatementTimeoutMs}ms`
			]);
			uniquePlan = await explainRunner(runner, uniqueBucketHashGlobalSql);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}

		const queueAccesses = readRelationAccesses(uniquePlan).filter(
			(access) => access.relation === 'history_archive_object_queue'
		);
		expect(queueAccesses).toEqual([
			expect.objectContaining({
				indexName: archiveObjectGlobalBucketHashIndexName,
				nodeType: 'Index Only Scan'
			})
		]);
		expect(
			queueAccesses.some(
				(access) =>
					access.nodeType === 'Seq Scan' ||
					access.nodeType === 'Bitmap Heap Scan'
			)
		).toBe(false);
		expect(readNodeTypes(uniquePlan)).not.toContain('Sort');
		await expect(
			getExactUniqueBucketHashCount(dataSource.manager, null)
		).resolves.toBe(uniqueBucketHashes);
	});
});

async function createScaleFixture(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			status text not null,
			"failureChannel" text,
			"checkpointLedger" integer,
			"bucketHash" text,
			"executionDisposition" text,
			"dependencyReady" boolean
		)
	`);
	await dataSource.query(`
		create index "${archiveObjectBucketHashIndexName}"
		on history_archive_object_queue (
			"archiveUrlIdentity", "bucketHash"
		)
		include (status, "executionDisposition", "dependencyReady")
		where "objectType" = 'bucket' and "bucketHash" is not null
	`);
	await dataSource.query(`
		create index "${archiveObjectGlobalBucketHashIndexName}"
		on history_archive_object_queue ("bucketHash")
		where "objectType" = 'bucket' and "bucketHash" is not null
	`);
	await dataSource.query(`
		create table history_archive_object_type_summary (
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"totalObjects" bigint not null,
			"pendingObjects" bigint not null,
			"scanningObjects" bigint not null,
			"verifiedObjects" bigint not null,
			"remoteFailureObjects" bigint not null,
			"scannerIssueObjects" bigint not null,
			primary key ("archiveUrlIdentity", "objectType")
		)
	`);
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
		create table history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity" text not null,
			"latestCheckpointLedger" integer,
			"objectCompleteCheckpointProofs" bigint not null,
			"verifiedCheckpointProofs" bigint not null
		)
	`);
	await dataSource.query(
		`insert into history_archive_state_snapshot (
			"archiveUrl", "archiveUrlIdentity", "stateUrl", status,
			"observedAt", source, "currentLedger"
		)
		select identity, identity, identity || '/.well-known/stellar-history.json',
			'available', now(), 'network-scan', 63
		from (
			select 'https://archive-' || item || '.example' as identity
			from generate_series(1, $1::integer) item
		) archives`,
		[archiveCount]
	);
	await dataSource.query(`
		insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status,
			"executionDisposition", "dependencyReady"
		)
		select "archiveUrlIdentity", 'history-archive-state', 'verified',
			'executable', true
		from history_archive_state_snapshot
	`);
	await dataSource.query(
		`insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status, "bucketHash",
			"executionDisposition", "dependencyReady"
		)
		select
			'https://archive-' || (1 + item % $2::integer) || '.example',
			'bucket',
			case item % 4
				when 0 then 'pending'
				when 1 then 'scanning'
				when 2 then 'verified'
				else 'failed'
			end,
			lpad(to_hex(item % $3::integer), 64, '0'),
			'executable', true
		from generate_series(1, $1::integer) item`,
		[bucketRows, archiveCount, uniqueBucketHashes]
	);
	await dataSource.query(`
		insert into history_archive_object_type_summary (
			"archiveUrlIdentity", "objectType", "totalObjects",
			"pendingObjects", "scanningObjects", "verifiedObjects",
			"remoteFailureObjects", "scannerIssueObjects"
		)
		select "archiveUrlIdentity", "objectType", count(*),
			count(*) filter (where status = 'pending'),
			count(*) filter (where status = 'scanning'),
			count(*) filter (where status = 'verified'), 0, 0
		from history_archive_object_queue
		group by "archiveUrlIdentity", "objectType"
	`);
	await dataSource.query('vacuum analyze history_archive_object_queue');
	await dataSource.query('analyze history_archive_object_type_summary');
	await dataSource.query('analyze history_archive_state_snapshot');
}

type QueryPlanNode = {
	readonly 'Index Name'?: string;
	readonly 'Node Type'?: string;
	readonly Plans?: readonly QueryPlanNode[];
	readonly 'Relation Name'?: string;
};

type QueryPlan = {
	readonly Plan?: QueryPlanNode;
};

type RelationAccess = {
	readonly indexName: string | null;
	readonly nodeType: string;
	readonly relation: string;
};

async function explainDataSource(
	dataSource: DataSource,
	sql: string,
	parameters: readonly unknown[]
): Promise<QueryPlan> {
	const value: unknown = await dataSource.query(
		`explain (analyze, buffers, format json) ${sql}`,
		[...parameters]
	);
	return parsePlan(value);
}

async function explainRunner(
	runner: QueryRunner,
	sql: string
): Promise<QueryPlan> {
	const value: unknown = await runner.query(
		`explain (analyze, buffers, format json) ${sql}`
	);
	return parsePlan(value);
}

function parsePlan(value: unknown): QueryPlan {
	if (!Array.isArray(value)) throw new Error('Expected PostgreSQL plan rows');
	const row: unknown = value[0];
	if (typeof row !== 'object' || row === null || Array.isArray(row)) {
		throw new Error('Expected PostgreSQL plan row');
	}
	const plans: unknown = (row as Readonly<Record<string, unknown>>)[
		'QUERY PLAN'
	];
	if (!Array.isArray(plans)) throw new Error('Expected PostgreSQL JSON plan');
	const plan: unknown = plans[0];
	if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
		throw new Error('Expected PostgreSQL plan object');
	}
	return plan as QueryPlan;
}

function readRelationAccesses(plan: QueryPlan): readonly RelationAccess[] {
	const accesses: RelationAccess[] = [];
	visitPlan(plan.Plan, (node) => {
		const relation = node['Relation Name'];
		const nodeType = node['Node Type'];
		if (relation !== undefined && nodeType !== undefined) {
			accesses.push({
				indexName: node['Index Name'] ?? null,
				nodeType,
				relation
			});
		}
	});
	return accesses;
}

function readNodeTypes(plan: QueryPlan): readonly string[] {
	const nodeTypes: string[] = [];
	visitPlan(plan.Plan, (node) => {
		if (node['Node Type'] !== undefined) nodeTypes.push(node['Node Type']);
	});
	return nodeTypes;
}

function visitPlan(
	node: QueryPlanNode | undefined,
	visit: (node: QueryPlanNode) => void
): void {
	if (node === undefined) return;
	visit(node);
	for (const child of node.Plans ?? []) visitPlan(child, visit);
}
