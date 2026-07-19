import { access } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { knownArchiveCopyCoverageSql } from '../KnownArchiveCopyCoverageQuery.js';
import {
	knownArchiveFailureCountSql,
	knownArchiveFailurePageSql
} from '../KnownArchiveFailurePageQuery.js';

jest.setTimeout(180_000);

const targetRoot = 'https://target.example';
const copyRoot = 'https://copy.example';
const sourceRemoteId = '11111111-1111-4111-8111-111111111111';
const copyRemoteId = '22222222-2222-4222-8222-222222222222';
const irrelevantObjectCount = 1_000_000;
const irrelevantEventCount = 500_000;
const snapshotAt = new Date('2026-07-16T01:00:00.000Z');

describe('known archive failed evidence query scale', () => {
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

	it('uses summaries and identity indexes instead of full object or event scans', async () => {
		const countRows = (await dataSource.query(
			knownArchiveFailureCountSql('remote'),
			[[targetRoot], targetRoot, 'transactions', snapshotAt]
		)) as readonly {
			readonly failureCount?: string;
			readonly rollupComplete?: boolean;
		}[];
		const pageRows = (await dataSource.query(
			knownArchiveFailurePageSql('remote'),
			[[targetRoot], targetRoot, 'transactions', snapshotAt, null, null, 2]
		)) as readonly { readonly remoteId?: string }[];
		const copyRows = (await dataSource.query(knownArchiveCopyCoverageSql, [
			[sourceRemoteId],
			[targetRoot, copyRoot],
			5,
			snapshotAt
		])) as readonly {
			readonly remoteId?: string;
			readonly sourceRemoteId?: string;
		}[];
		expect(countRows).toEqual([
			expect.objectContaining({
				failureCount: '1',
				rollupComplete: true
			})
		]);
		expect(pageRows).toEqual([
			expect.objectContaining({ remoteId: sourceRemoteId })
		]);
		expect(copyRows).toEqual([
			expect.objectContaining({
				remoteId: copyRemoteId,
				sourceRemoteId
			})
		]);
		const countPlan = await explain(
			dataSource,
			knownArchiveFailureCountSql('remote'),
			[[targetRoot], targetRoot, 'transactions', snapshotAt]
		);
		const pagePlan = await explain(
			dataSource,
			knownArchiveFailurePageSql('remote'),
			[[targetRoot], targetRoot, 'transactions', snapshotAt, null, null, 2]
		);
		const copyPlan = await explain(dataSource, knownArchiveCopyCoverageSql, [
			[sourceRemoteId],
			[targetRoot, copyRoot],
			5,
			snapshotAt
		]);

		expect(hasSequentialScan(countPlan, 'history_archive_object_queue')).toBe(
			false
		);
		expect(hasSequentialScan(pagePlan, 'history_archive_object_queue')).toBe(
			false
		);
		expect(hasSequentialScan(copyPlan, 'history_archive_object_queue')).toBe(
			false
		);
		expect(hasSequentialScan(copyPlan, 'history_archive_object_event')).toBe(
			false
		);
		expect(readRelations(countPlan)).toEqual(
			expect.arrayContaining(['history_archive_object_type_summary'])
		);
		expect(readRelations(copyPlan)).toEqual(
			expect.arrayContaining([
				'history_archive_object_queue',
				'history_archive_object_event'
			])
		);
		expect(countPlan['Execution Time'] ?? Infinity).toBeLessThan(1_500);
		expect(pagePlan['Execution Time'] ?? Infinity).toBeLessThan(1_500);
		expect(copyPlan['Execution Time'] ?? Infinity).toBeLessThan(1_500);
		process.stdout.write(
			`FAILED_ARCHIVE_EVIDENCE_SCALE ${JSON.stringify({
				copy: summarize(copyPlan),
				count: summarize(countPlan),
				irrelevantEventCount,
				irrelevantObjectCount,
				page: summarize(pagePlan)
			})}\n`
		);
	});
});

type QueryPlanNode = {
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

function relationNodes(
	plan: QueryPlan,
	relationName: string
): readonly QueryPlanNode[] {
	const nodes: QueryPlanNode[] = [];
	visit(plan.Plan, (node) => {
		if (node['Relation Name'] === relationName) nodes.push(node);
	});
	return nodes;
}

function hasSequentialScan(plan: QueryPlan, relationName: string): boolean {
	return relationNodes(plan, relationName).some(
		(node) => node['Node Type'] === 'Seq Scan'
	);
}

function readRelations(plan: QueryPlan): readonly string[] {
	const relations: string[] = [];
	visit(plan.Plan, (node) => {
		if (node['Relation Name'] !== undefined) {
			relations.push(node['Relation Name']);
		}
	});
	return relations;
}

function summarize(plan: QueryPlan) {
	const nodes: string[] = [];
	visit(plan.Plan, (node) => {
		if (node['Node Type'] !== undefined) nodes.push(node['Node Type']);
	});
	return {
		executionMs: plan['Execution Time'] ?? null,
		nodes,
		relations: readRelations(plan)
	};
}

function visit(
	node: QueryPlanNode | undefined,
	visitor: (node: QueryPlanNode) => void
): void {
	if (node === undefined) return;
	visitor(node);
	for (const child of node.Plans ?? []) visit(child, visitor);
}

async function createFixture(source: DataSource): Promise<void> {
	await source.query(`
		create unlogged table history_archive_object_queue (
			id bigserial primary key,
			"remoteId" uuid not null,
			"archiveUrl" text not null,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"objectKey" text not null,
			"objectUrl" text not null,
			"checkpointLedger" integer,
			"bucketHash" text,
			status text not null,
			"failureChannel" text,
			"verificationFacts" jsonb,
			"verifiedAt" timestamptz,
			"createdAt" timestamptz not null,
			"updatedAt" timestamptz not null
		);
		create unique index idx_history_archive_object_remote
			on history_archive_object_queue ("remoteId");
		create unique index uq_history_archive_object_identity
			on history_archive_object_queue (
				"archiveUrlIdentity", "objectType", "objectKey"
			);
		create index idx_history_archive_object_archive
			on history_archive_object_queue ("archiveUrlIdentity", status);
		create index idx_history_archive_object_evidence_summary
			on history_archive_object_queue ("archiveUrlIdentity", "createdAt")
			include (status, "objectType", "failureChannel");
		create index idx_history_archive_object_key
			on history_archive_object_queue ("objectType", "objectKey");

		create unlogged table history_archive_object_event (
			"remoteId" uuid not null,
			"objectRemoteId" uuid not null,
			"eventType" text not null,
			"verificationFacts" jsonb,
			"createdAt" timestamptz not null
		);
		create unique index idx_history_archive_object_event_id
			on history_archive_object_event ("remoteId");
		create index idx_history_archive_object_event_remote
			on history_archive_object_event ("objectRemoteId", "createdAt");

		create table history_archive_state_snapshot (
			"archiveUrlIdentity" text primary key,
			status text not null,
			"networkPassphrase" text
		);
		create table history_archive_evidence_root_summary (
			"archiveUrlIdentity" text primary key,
			"remoteFailureObjects" bigint not null,
			"workerIssueObjects" bigint not null
		);
		create table history_archive_evidence_root_summary_progress (
			id smallint primary key,
			"cutoffObjectId" bigint not null,
			"lastObjectId" bigint not null,
			"complete" boolean not null
		);
		create table history_archive_object_type_summary (
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"remoteFailureObjects" bigint not null,
			"scannerIssueObjects" bigint not null,
			primary key ("archiveUrlIdentity", "objectType")
		);
		create table history_archive_object_type_summary_progress (
			id smallint primary key,
			"cutoffObjectId" bigint not null,
			"lastObjectId" bigint not null,
			"completedAt" timestamptz,
			"complete" boolean not null
		);
	`);
	await source.query(irrelevantObjectFixtureSql, [irrelevantObjectCount]);
	await source.query(targetObjectFixtureSql, [
		sourceRemoteId,
		copyRemoteId,
		targetRoot,
		copyRoot
	]);
	await source.query(irrelevantEventFixtureSql, [irrelevantEventCount]);
	await source.query(
		`insert into history_archive_state_snapshot values
			($1, 'available', 'Public Global Stellar Network ; September 2015'),
			($2, 'available', 'Public Global Stellar Network ; September 2015')`,
		[targetRoot, copyRoot]
	);
	await source.query(
		'insert into history_archive_evidence_root_summary values ($1, 1, 0)',
		[targetRoot]
	);
	await source.query(`
		insert into history_archive_evidence_root_summary_progress
		select 1, coalesce(max(id), 0), coalesce(max(id), 0), true
		from history_archive_object_queue
	`);
	await source.query(
		`insert into history_archive_object_type_summary
		 values ($1, 'transactions', 1, 0)`,
		[targetRoot]
	);
	await source.query(`
		insert into history_archive_object_type_summary_progress
		select 1, coalesce(max(id), 0), coalesce(max(id), 0), now(), true
		from history_archive_object_queue
	`);
	await source.query(
		'analyze history_archive_object_queue; analyze history_archive_object_event'
	);
}

const irrelevantObjectFixtureSql = `
	insert into history_archive_object_queue (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
		"objectKey", "objectUrl", status, "createdAt", "updatedAt"
	)
	select
		(
			'33333333-3333-4333-8333-' ||
			lpad(to_hex(object_index), 12, '0')
		)::uuid,
		'https://irrelevant.example',
		'https://irrelevant.example',
		'ledger',
		'ledger:' || lpad(to_hex(object_index), 16, '0'),
		'https://irrelevant.example/ledger/' || object_index,
		'pending',
		'2026-07-15T00:00:00Z'::timestamptz,
		'2026-07-15T00:00:00Z'::timestamptz
	from generate_series(1, $1::integer) object_index
`;

const targetObjectFixtureSql = `
	insert into history_archive_object_queue (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
		"objectKey", "objectUrl", "checkpointLedger", status,
		"failureChannel", "verificationFacts", "verifiedAt",
		"createdAt", "updatedAt"
	) values
		(
			$1::uuid, $3, $3, 'transactions', 'transactions:0000003f',
			$3 || '/transactions/0000003f.xdr.gz', 63, 'failed',
			'archive_evidence', null, null,
			'2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		),
		(
			$2::uuid, $4, $4, 'transactions', 'transactions:0000003f',
			$4 || '/transactions/0000003f.xdr.gz', 63, 'verified',
			null,
			jsonb_build_object('content', jsonb_build_object(
				'algorithm', 'sha256',
				'digest', repeat('7', 64),
				'representation', 'uncompressed-xdr'
			)),
			'2026-07-15T00:00:00Z',
			'2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		)
`;

const irrelevantEventFixtureSql = `
	insert into history_archive_object_event (
		"remoteId", "objectRemoteId", "eventType", "createdAt"
	)
	select
		(
			'44444444-4444-4444-8444-' ||
			lpad(to_hex(event_index), 12, '0')
		)::uuid,
		(
			'33333333-3333-4333-8333-' ||
			lpad(to_hex(event_index), 12, '0')
		)::uuid,
		'heartbeat',
		'2026-07-15T00:00:00Z'::timestamptz
	from generate_series(1, $1::integer) event_index
`;
