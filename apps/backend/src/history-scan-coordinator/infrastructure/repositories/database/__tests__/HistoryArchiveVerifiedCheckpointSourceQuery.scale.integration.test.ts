import { access } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveVerifiedCheckpointSourceSql } from '../HistoryArchiveVerifiedCheckpointSourceQuery.js';

jest.setTimeout(180_000);

const targetRoot = 'https://target.example.com/archive';
const firstRoot = 'https://first.example.com/archive';
const secondRoot = 'https://second.example.com/archive';
const targetRemoteId = '11111111-1111-4111-8111-111111111111';
const firstRemoteId = '22222222-2222-4222-8222-222222222222';
const secondRemoteId = '33333333-3333-4333-8333-333333333333';
const contentDigest = '7'.repeat(64);
const irrelevantObjectCount = 1_000_000;

describe('verified checkpoint replacement source query scale', () => {
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

	it('uses indexed exact identities and strict multi-source proof under load', async () => {
		const rows = (await dataSource.query(
			historyArchiveVerifiedCheckpointSourceSql,
			[[targetRemoteId], 5]
		)) as readonly {
			readonly anchorKind?: string;
			readonly candidateRemoteId?: string;
			readonly corroboratingSourceCount?: number;
		}[];
		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					anchorKind: 'multi-source',
					candidateRemoteId: firstRemoteId,
					corroboratingSourceCount: 2
				}),
				expect.objectContaining({
					anchorKind: 'multi-source',
					candidateRemoteId: secondRemoteId,
					corroboratingSourceCount: 2
				})
			])
		);

		const plan = await explain(
			dataSource,
			historyArchiveVerifiedCheckpointSourceSql,
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
			`VERIFIED_CHECKPOINT_SOURCE_SCALE ${JSON.stringify({
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

function readSequentialScans(plan: QueryPlan): readonly {
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
	await source.query(schemaSql);
	await source.query(irrelevantObjectsSql, [irrelevantObjectCount]);
	await source.query(targetObjectSql, [targetRemoteId, targetRoot]);
	await insertProvenSource(source, {
		archiveRoot: firstRoot,
		candidateRemoteId: firstRemoteId,
		idPrefix: '55555555-5555-4555-8555-0000000000'
	});
	await insertProvenSource(source, {
		archiveRoot: secondRoot,
		candidateRemoteId: secondRemoteId,
		idPrefix: '66666666-6666-4666-8666-0000000000'
	});
	await source.query(
		`insert into history_archive_state_snapshot values
			($1, 'available', 'Public Global Stellar Network ; September 2015'),
			($2, 'available', 'Public Global Stellar Network ; September 2015'),
			($3, 'available', 'Public Global Stellar Network ; September 2015')`,
		[targetRoot, firstRoot, secondRoot]
	);
	await source.query('analyze history_archive_object_queue');
}

async function insertProvenSource(
	source: DataSource,
	input: {
		readonly archiveRoot: string;
		readonly candidateRemoteId: string;
		readonly idPrefix: string;
	}
): Promise<void> {
	const checkpointStateId = `${input.idPrefix}01`;
	const ledgerId = `${input.idPrefix}02`;
	const resultsId = `${input.idPrefix}04`;
	await source.query(proofInputsSql, [
		input.archiveRoot,
		checkpointStateId,
		ledgerId,
		input.candidateRemoteId,
		resultsId,
		contentDigest
	]);
	await source.query(proofSql, [
		input.archiveRoot,
		checkpointStateId,
		ledgerId,
		input.candidateRemoteId,
		resultsId
	]);
}

const schemaSql = `
	create unlogged table history_archive_object_queue (
			"remoteId" uuid primary key,
			"archiveUrl" text not null,
			"archiveUrlIdentity" text not null,
			"hostIdentity" text not null,
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
	create unique index uq_history_archive_object_identity
		on history_archive_object_queue (
			"archiveUrlIdentity", "objectType", "objectKey"
		);
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
	create table history_archive_object_event (
		"remoteId" uuid primary key,
		"objectRemoteId" uuid not null,
		"eventType" text not null,
		"verificationFacts" jsonb,
		"createdAt" timestamptz not null default now()
	);
	create index idx_history_archive_object_event_remote
		on history_archive_object_event ("objectRemoteId", "createdAt");
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
`;

const irrelevantObjectsSql = `
		insert into history_archive_object_queue (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity", "objectType",
			"objectKey", "objectUrl", status
	)
	select
		(
			'99999999-9999-4999-8999-' ||
			lpad(to_hex(object_index), 12, '0')
		)::uuid,
			'https://irrelevant.example.com/archive',
			'https://irrelevant.example.com/archive',
			'irrelevant.example.com',
			'ledger',
		'ledger:' || lpad(to_hex(object_index), 16, '0'),
		'https://irrelevant.example.com/archive/ledger/' || object_index,
		'pending'
	from generate_series(1, $1::integer) object_index
`;

const targetObjectSql = `
		insert into history_archive_object_queue (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity", "objectType",
			"objectKey", "objectUrl", "checkpointLedger", status, "updatedAt"
		) values (
			$1::uuid, $2, $2, 'target.example.com', 'transactions',
			'transactions:0000003f',
		$2 || '/transactions/00/00/00/transactions-0000003f.xdr.gz',
		63, 'failed', '2026-07-15T00:00:00Z'
	)
`;

const proofInputsSql = `
		insert into history_archive_object_queue (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity", "objectType",
			"objectKey", "objectUrl", "checkpointLedger", status,
		"verificationFacts", "verifiedAt", "updatedAt"
	) values
		(
				$2::uuid, $1, $1,
				split_part(split_part($1, '://', 2), '/', 1),
				'checkpoint-state', 'checkpoint-state:0000003f',
			$1 || '/history/00/00/00/history-0000003f.json', 63, 'verified',
			null, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		),
		(
				$3::uuid, $1, $1,
				split_part(split_part($1, '://', 2), '/', 1),
				'ledger', 'ledger:0000003f',
			$1 || '/ledger/00/00/00/ledger-0000003f.xdr.gz', 63, 'verified',
			null, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		),
		(
				$4::uuid, $1, $1,
				split_part(split_part($1, '://', 2), '/', 1),
				'transactions', 'transactions:0000003f',
			$1 || '/transactions/00/00/00/transactions-0000003f.xdr.gz',
			63, 'verified',
			jsonb_build_object(
				'content', jsonb_build_object(
					'algorithm', 'sha256', 'digest', $6::text,
					'representation', 'uncompressed-xdr'
				)
			),
			'2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		),
		(
				$5::uuid, $1, $1,
				split_part(split_part($1, '://', 2), '/', 1),
				'results', 'results:0000003f',
			$1 || '/results/00/00/00/results-0000003f.xdr.gz', 63, 'verified',
			null, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
		)
`;

const proofSql = `
	insert into history_archive_checkpoint_proof (
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
		0, 0, 0, 0,
		$2::uuid, $3::uuid, $4::uuid, $5::uuid, null,
		'2026-07-15T00:01:00Z'
	)
`;
