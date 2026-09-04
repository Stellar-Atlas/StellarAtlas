import { access } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveVerifiedBucketSourceSql } from '../HistoryArchiveVerifiedBucketSourceQuery.js';

jest.setTimeout(180_000);

const targetRoot = 'https://target.example.com/archive';
const copyRoot = 'https://copy.example.com/archive';
const targetRemoteId = '11111111-1111-4111-8111-111111111111';
const copyRemoteId = '22222222-2222-4222-8222-222222222222';
const bucketHash = '7'.repeat(64);
const irrelevantObjectCount = 1_000_000;

describe('verified bucket replacement source query scale', () => {
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

	it('uses object identities and indexed bucket keys under scanner load', async () => {
		const rows = (await dataSource.query(
			historyArchiveVerifiedBucketSourceSql,
			[[targetRemoteId], 5]
		)) as readonly {
			readonly candidateRemoteId?: string;
			readonly targetRemoteId?: string;
		}[];
		expect(rows).toEqual([
			expect.objectContaining({
				candidateRemoteId: copyRemoteId,
				targetRemoteId
			})
		]);

		const plan = await explain(
			dataSource,
			historyArchiveVerifiedBucketSourceSql,
			[[targetRemoteId], 5]
		);
		const sequentialScans = readSequentialScans(plan);
		expect(sequentialScans).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ relation: 'history_archive_object_queue' })
			])
		);
		expect(plan['Execution Time'] ?? Infinity).toBeLessThan(1_500);
		process.stdout.write(
			`VERIFIED_BUCKET_SOURCE_SCALE ${JSON.stringify({
				executionMs: plan['Execution Time'] ?? null,
				irrelevantObjectCount,
				relations: readRelations(plan)
			})}\n`
		);
	});
});

type QueryPlanNode = {
	readonly Alias?: string;
	readonly Filter?: string;
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

function readSequentialScans(
	plan: QueryPlan
): readonly {
	alias: string | null;
	filter: string | null;
	relation: string;
}[] {
	const scans: {
		alias: string | null;
		filter: string | null;
		relation: string;
	}[] = [];
	visit(plan.Plan, (node) => {
		if (
			node['Relation Name'] !== undefined &&
			node['Node Type'] === 'Seq Scan'
		) {
			scans.push({
				alias: node.Alias ?? null,
				filter: node.Filter ?? null,
				relation: node['Relation Name']
			});
		}
	});
	return scans;
}

function readRelations(plan: QueryPlan): readonly string[] {
	const relations = new Set<string>();
	visit(plan.Plan, (node) => {
		if (node['Relation Name'] !== undefined) {
			relations.add(node['Relation Name']);
		}
	});
	return Array.from(relations);
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
			"remoteId" uuid primary key,
			"archiveUrl" text not null,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"objectKey" text not null,
			"objectUrl" text not null,
			"checkpointLedger" integer,
			"bucketHash" text,
			status text not null,
			"verificationFacts" jsonb,
			"verifiedAt" timestamptz,
			"updatedAt" timestamptz not null default now()
		);
			create index idx_history_archive_object_key
				on history_archive_object_queue ("objectType", "objectKey");
			create index idx_history_archive_object_checkpoint_refresh
				on history_archive_object_queue (
					"archiveUrlIdentity", "checkpointLedger", "objectType", status
				)
				where "checkpointLedger" is not null;
		create table history_archive_state_snapshot (
			"archiveUrlIdentity" text primary key,
			status text not null,
			"networkPassphrase" text
		);
		create table history_archive_checkpoint_bucket_dependency (
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			"bucketHash" text not null,
			"createdAt" timestamptz not null default now(),
			primary key ("archiveUrlIdentity", "checkpointLedger", "bucketHash")
		);
		create table history_archive_checkpoint_proof (
			id serial primary key,
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			status text not null,
			"proofVersion" smallint not null,
			"requiredObjectsComplete" boolean not null,
			"proofFactsComplete" boolean not null,
			"checkpointBucketListMatches" boolean not null,
			"transactionsMatch" boolean not null,
			"resultsMatch" boolean not null,
				"previousLedgersMatch" boolean not null,
				"bucketsVerified" boolean not null,
				"expectedBucketCount" integer not null,
				"verifiedBucketCount" integer not null,
				"failedBucketCount" integer not null,
				"missingBucketCount" integer not null,
			"checkpointStateObjectRemoteId" uuid,
			"ledgerObjectRemoteId" uuid,
			"transactionsObjectRemoteId" uuid,
			"resultsObjectRemoteId" uuid,
			"scpObjectRemoteId" uuid,
			"evaluatedAt" timestamptz not null,
			unique ("archiveUrlIdentity", "checkpointLedger")
		);
	`);
	await source.query(irrelevantObjectsSql, [irrelevantObjectCount]);
	await source.query(repairObjectsSql, [
		targetRemoteId,
		copyRemoteId,
		targetRoot,
		copyRoot,
		bucketHash
	]);
	await source.query(proofInputsSql, [copyRoot]);
	await source.query(
		`insert into history_archive_state_snapshot values
			($1, 'available', 'Public Global Stellar Network ; September 2015'),
			($2, 'available', 'Public Global Stellar Network ; September 2015')`,
		[targetRoot, copyRoot]
	);
	await source.query(
		`insert into history_archive_checkpoint_bucket_dependency
			("archiveUrlIdentity", "checkpointLedger", "bucketHash", "createdAt")
		 values ($1, 63, $2, '2026-07-15T00:00:00Z')`,
		[copyRoot, bucketHash]
	);
	await source.query(
		`insert into history_archive_checkpoint_proof (
			"archiveUrlIdentity", "checkpointLedger", status, "proofVersion",
			"requiredObjectsComplete", "proofFactsComplete",
				"checkpointBucketListMatches", "transactionsMatch", "resultsMatch",
				"previousLedgersMatch", "bucketsVerified",
				"expectedBucketCount", "verifiedBucketCount",
				"failedBucketCount", "missingBucketCount",
				"checkpointStateObjectRemoteId", "ledgerObjectRemoteId",
			"transactionsObjectRemoteId", "resultsObjectRemoteId",
			"scpObjectRemoteId", "evaluatedAt"
		) values (
				$1, 63, 'verified', 7, true, true, true, true, true, true, true,
				1, 1, 0, 0,
			'55555555-5555-4555-8555-000000000001',
			'55555555-5555-4555-8555-000000000002',
			'55555555-5555-4555-8555-000000000003',
			'55555555-5555-4555-8555-000000000004', null,
			'2026-07-15T00:01:00Z'
		)`,
		[copyRoot]
	);
	await source.query('analyze history_archive_object_queue');
}

const irrelevantObjectsSql = `
	insert into history_archive_object_queue (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
		"objectKey", "objectUrl", status
	)
	select
		(
			'33333333-3333-4333-8333-' ||
			lpad(to_hex(object_index), 12, '0')
		)::uuid,
		'https://irrelevant.example.com/archive',
		'https://irrelevant.example.com/archive',
		'ledger',
		'ledger:' || lpad(to_hex(object_index), 16, '0'),
		'https://irrelevant.example.com/archive/ledger/' || object_index,
		'pending'
	from generate_series(1, $1::integer) object_index
`;

const proofInputsSql = `
	insert into history_archive_object_queue (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
		"objectKey", "objectUrl", "checkpointLedger", status,
		"verifiedAt", "updatedAt"
	)
	select
		(
			'55555555-5555-4555-8555-' || lpad(input.ordinal::text, 12, '0')
		)::uuid,
		$1, $1, input.object_type, input.object_type || ':0000003f',
		$1 || '/' || input.object_type || '/0000003f', 63, 'verified',
		'2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
	from (values
		(1, 'checkpoint-state'),
		(2, 'ledger'),
		(3, 'transactions'),
		(4, 'results')
	) input(ordinal, object_type)
`;

const repairObjectsSql = `
	insert into history_archive_object_queue (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "objectType",
		"objectKey", "objectUrl", "bucketHash", status,
		"verificationFacts", "verifiedAt", "updatedAt"
	) values
		(
			$1::uuid, $3, $3, 'bucket', 'bucket:' || $5,
			$3 || '/bucket/77/77/77/bucket-' || $5 || '.xdr.gz',
			$5, 'failed', null, null, '2026-07-15T00:00:00Z'
		),
		(
			$2::uuid, $4, $4, 'bucket', 'bucket:' || $5,
			$4 || '/bucket/77/77/77/bucket-' || $5 || '.xdr.gz',
			$5, 'verified',
			jsonb_build_object(
				'bucketObject', jsonb_build_object(
					'expectedBucketHash', $5,
					'matched', true,
					'sourceUrl', $4 || '/bucket/77/77/77/bucket-' || $5 || '.xdr.gz'
				),
				'content', jsonb_build_object(
					'algorithm', 'sha256',
					'digest', $5,
					'representation', 'uncompressed-xdr'
				)
			),
			'2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		)
`;
