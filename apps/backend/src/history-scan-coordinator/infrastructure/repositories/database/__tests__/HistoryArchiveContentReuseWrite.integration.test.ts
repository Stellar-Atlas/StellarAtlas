import 'reflect-metadata';
import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { HistoryArchiveObjectProgressUpdate } from '../../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { fullHistoryObservedLedgersSql } from '../../../database/full-history-promotion/FullHistoryCandidateSql.js';
import { HistoryArchiveContentReuseMigration1785520000000 } from '../../../database/migrations/1785520000000-HistoryArchiveContentReuseMigration.js';
import {
	findReusableHistoryArchiveContent,
	prepareHistoryArchiveContentCompletion,
	prepareHistoryArchiveContentCompletions,
	recordHistoryArchiveContentEvidence
} from '../HistoryArchiveContentReuseWrite.js';

jest.setTimeout(60_000);

const sourceRemoteId = 'f84ee265-b3ac-43ca-b55e-7cc3bb086e54';
const targetRemoteId = '277d58a0-0185-4c94-90ec-cbfd4e3ad2d4';
const sourceExecutionId = '8c1a3ab7-9514-4fe0-9ae4-d5b752616677';
const targetExecutionId = '06161c4e-c064-408a-9f98-6feb15f2db08';
const digest = 'a'.repeat(64);
const objectKey = 'ledger:0000003f';
const sourceUrl = 'https://source.example/ledger-0000003f.xdr.gz';
const targetUrl = 'https://target.example/ledger-0000003f.xdr.gz';

describe('history archive content reuse in PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createFixtureSchema(dataSource);
		await runMigration(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('records one artifact, binds an exact broker claim, and reuses thin provenance', async () => {
		const sourceFacts = ledgerFacts(sourceUrl);
		await insertObject(dataSource, {
			attempts: 1,
			facts: sourceFacts,
			remoteId: sourceRemoteId,
			status: 'verified',
			url: sourceUrl
		});
		await dataSource.query(
			`insert into parsed_ledger_header (
				id, "ledgerSequence", "ledgerHeaderHash",
				"previousLedgerHeaderHash", "transactionSetHash",
				"transactionResultHash", "bucketListHash", "protocolVersion"
			 ) values (11, 63, $1, $2, $3, $4, $5, 23)`,
			[
				'c'.repeat(64),
				'd'.repeat(64),
				'f'.repeat(64),
				'e'.repeat(64),
				'b'.repeat(64)
			]
		);
		await dataSource.query(
			`insert into parsed_ledger_header_observation (
				"parsedLedgerHeaderId", "sourceObjectRemoteId", "observedAt", "closedAt"
			 ) values (11, $1, now(), now())`,
			[sourceRemoteId]
		);
		await recordHistoryArchiveContentEvidence(
			dataSource.manager,
			sourceRemoteId,
			{
				progress: {
					claimAttempt: 1,
					executionId: sourceExecutionId,
					scheduler: 'broker',
					verificationFacts: sourceFacts,
					workerStage: 'verified'
				},
				reuse: null
			}
		);

		await insertObject(dataSource, {
			attempts: 0,
			facts: null,
			remoteId: targetRemoteId,
			status: 'pending',
			url: targetUrl
		});
		await dataSource.query(
			`insert into history_archive_object_ready (
				"objectRemoteId", "dispatchToken", "claimAttempt", "publishedAt"
			 ) values ($1::uuid, $2::uuid, 1, now())`,
			[targetRemoteId, targetExecutionId]
		);

		const request = {
			claimAttempt: 1,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr' as const,
			derivationVersion: 1 as const,
			executionId: targetExecutionId,
			objectKey,
			objectType: 'ledger' as const,
			remoteId: targetRemoteId
		};
		const reusable = await findReusableHistoryArchiveContent(
			dataSource.manager,
			request
		);
		expect(reusable).not.toBeNull();
		expect(reusable?.verificationFacts).toMatchObject({
			content: { digest },
			ledgerCategory: { sourceUrl: targetUrl }
		});
		expect(
			await findReusableHistoryArchiveContent(dataSource.manager, {
				...request,
				executionId: sourceExecutionId
			})
		).toBeNull();

		const progress = {
			claimAttempt: 1,
			contentReuse: {
				artifactId: reusable!.artifactId,
				contentDigest: reusable!.contentDigest,
				contentRepresentation: reusable!.contentRepresentation,
				derivationVersion: reusable!.derivationVersion,
				sourceObjectRemoteId: reusable!.sourceObjectRemoteId
			},
			executionId: targetExecutionId,
			scheduler: 'broker' as const,
			verificationFacts: reusable!.verificationFacts,
			workerStage: 'verified'
		} satisfies HistoryArchiveObjectProgressUpdate;

		await dataSource.transaction(async (manager) => {
			const prepared = await prepareHistoryArchiveContentCompletion(
				manager,
				targetRemoteId,
				progress
			);
			await manager.query(
				`update history_archive_object_queue
				 set status = 'verified', attempts = 1,
					"verificationFacts" = $2::jsonb
				 where "remoteId" = $1::uuid`,
				[targetRemoteId, JSON.stringify(prepared.progress.verificationFacts)]
			);
			await recordHistoryArchiveContentEvidence(
				manager,
				targetRemoteId,
				prepared
			);
		});

		const artifacts = (await dataSource.query(
			`select id, "verificationFacts" from history_archive_content_artifact`
		)) as readonly {
			readonly id: string;
			readonly verificationFacts: {
				readonly ledgerCategory: { readonly sourceUrl?: string };
			};
		}[];
		expect(artifacts).toHaveLength(1);
		expect(
			artifacts[0]?.verificationFacts.ledgerCategory.sourceUrl
		).toBeUndefined();

		const observations = (await dataSource.query(
			`select "objectRemoteId", "artifactId"
			 from history_archive_content_observation
			 order by "objectRemoteId"`
		)) as readonly {
			readonly artifactId: string;
			readonly objectRemoteId: string;
		}[];
		expect(observations).toHaveLength(2);
		expect(new Set(observations.map((row) => row.artifactId))).toEqual(
			new Set([artifacts[0]!.id])
		);

		const targetProvenance = await dataSource.query(
			`select "parsedLedgerHeaderId"
			 from parsed_ledger_header_observation
			 where "sourceObjectRemoteId" = $1`,
			[targetRemoteId]
		);
		expect(targetProvenance).toEqual([]);

		const resolvedLedgers = (await dataSource.query(
			fullHistoryObservedLedgersSql,
			[targetRemoteId]
		)) as readonly {
			readonly ledgerHeaderHash: string;
			readonly ledgerSequence: number;
		}[];
		expect(resolvedLedgers).toHaveLength(1);
		expect(resolvedLedgers[0]).toMatchObject({
			ledgerHeaderHash: 'c'.repeat(64),
			ledgerSequence: 63
		});

		await expect(
			dataSource.query(
				`update history_archive_content_artifact set "objectKey" = 'changed'`
			)
		).rejects.toThrow(/append-only/);
		await expect(
			dataSource.query(`truncate history_archive_content_observation`)
		).rejects.toThrow(/append-only/);

		// The successful transaction committed, but its HTTP response was lost.
		// Normal completion removes the ready claim before a client can retry.
		await dataSource.query(
			`delete from history_archive_object_ready where "objectRemoteId" = $1`,
			[targetRemoteId]
		);
		await expect(
			prepareHistoryArchiveContentCompletions(dataSource.manager, [
				{ remoteId: targetRemoteId, progress }
			])
		).resolves.toEqual([]);

		const activeRemoteId = '792c1cc4-ae76-42e3-b610-2903a8c8d5ac';
		const activeExecutionId = '40adf94d-6e0f-4d20-8db8-114653577b7e';
		await insertObject(dataSource, {
			attempts: 0,
			facts: null,
			remoteId: activeRemoteId,
			status: 'pending',
			url: targetUrl
		});
		await dataSource.query(
			`insert into history_archive_object_ready (
				"objectRemoteId", "dispatchToken", "claimAttempt", "publishedAt"
			 ) values ($1::uuid, $2::uuid, 1, now())`,
			[activeRemoteId, activeExecutionId]
		);
		const activeProgress = { ...progress, executionId: activeExecutionId };
		const mixed = await prepareHistoryArchiveContentCompletions(
			dataSource.manager,
			[
				{ remoteId: targetRemoteId, progress },
				{ remoteId: activeRemoteId, progress: activeProgress }
			]
		);
		expect(mixed.map((item) => item.remoteId)).toEqual([activeRemoteId]);
		expect(mixed[0]?.prepared.progress.verificationFacts).toMatchObject({
			content: { digest },
			ledgerCategory: { sourceUrl: targetUrl }
		});

		// Neither a different token, attempt, nor an unpublished claim authorizes
		// this artifact. They are stale results, not accepted verification writes.
		for (const stale of [
			{ ...activeProgress, executionId: targetExecutionId },
			{ ...activeProgress, claimAttempt: 2 }
		]) {
			await expect(
				prepareHistoryArchiveContentCompletions(dataSource.manager, [
					{ remoteId: activeRemoteId, progress: stale }
				])
			).resolves.toEqual([]);
		}
		await dataSource.query(
			`update history_archive_object_ready
			set "publishedAt" = null where "objectRemoteId" = $1`,
			[activeRemoteId]
		);
		await expect(
			prepareHistoryArchiveContentCompletions(dataSource.manager, [
				{ remoteId: activeRemoteId, progress: activeProgress }
			])
		).resolves.toEqual([]);
		await dataSource.query(
			`update history_archive_object_ready
			set "publishedAt" = now() where "objectRemoteId" = $1`,
			[activeRemoteId]
		);

		// A live claim with a bad artifact remains an error, including when an
		// unrelated stale replay shares its batch. Do not turn either into success.
		for (const invalid of [
			{ ...activeProgress.contentReuse, contentDigest: '0'.repeat(64) },
			{ ...activeProgress.contentReuse, sourceObjectRemoteId: targetRemoteId },
			{ ...activeProgress.contentReuse, artifactId: activeRemoteId }
		]) {
			await expect(
				prepareHistoryArchiveContentCompletions(dataSource.manager, [
					{ remoteId: targetRemoteId, progress },
					{
						remoteId: activeRemoteId,
						progress: { ...activeProgress, contentReuse: invalid }
					}
				])
			).rejects.toThrow(
				'Content reuse artifact does not match the active claim'
			);
		}
		for (const changed of [
			{ key: 'ledger:0000007f', checkpoint: 63, type: 'ledger' },
			{ key: objectKey, checkpoint: 127, type: 'ledger' },
			{ key: objectKey, checkpoint: 63, type: 'transactions' }
		]) {
			await dataSource.query(
				`update history_archive_object_queue
				set "objectKey" = $2, "checkpointLedger" = $3, "objectType" = $4
				where "remoteId" = $1`,
				[activeRemoteId, changed.key, changed.checkpoint, changed.type]
			);
			await expect(
				prepareHistoryArchiveContentCompletions(dataSource.manager, [
					{ remoteId: activeRemoteId, progress: activeProgress }
				])
			).rejects.toThrow(
				'Content reuse artifact does not match the active claim'
			);
		}
		expect(
			await dataSource.query(
				`select status, attempts, "verificationFacts"
			from history_archive_object_queue where "remoteId" = $1`,
				[activeRemoteId]
			)
		).toEqual([{ status: 'pending', attempts: 0, verificationFacts: null }]);
		expect(
			await dataSource.query(`select count(*)::int as count
			from history_archive_content_observation`)
		).toEqual([{ count: 2 }]);
	});
});

function ledgerFacts(sourceUrlValue: string) {
	return {
		content: {
			algorithm: 'sha256',
			digest,
			representation: 'uncompressed-xdr'
		},
		ledgerCategory: {
			entryCount: 1,
			headerHashesVerified: true,
			ledgers: [
				{
					bucketListHash: 'b'.repeat(64),
					ledger: 63,
					ledgerHeaderHash: 'c'.repeat(64),
					previousLedgerHeaderHash: 'd'.repeat(64),
					protocolVersion: 23,
					transactionResultSetHash: 'e'.repeat(64),
					transactionSetHash: 'f'.repeat(64)
				}
			],
			sourceUrl: sourceUrlValue
		}
	};
}

async function insertObject(
	dataSourceValue: DataSource,
	value: {
		readonly attempts: number;
		readonly facts: object | null;
		readonly remoteId: string;
		readonly status: string;
		readonly url: string;
	}
): Promise<void> {
	await dataSourceValue.query(
		`insert into history_archive_object_queue (
			"remoteId", "objectType", "objectKey", "checkpointLedger",
			status, attempts, "verificationFacts", "objectUrl"
		 ) values ($1::uuid, 'ledger', $2, 63, $3, $4, $5::jsonb, $6)`,
		[
			value.remoteId,
			objectKey,
			value.status,
			value.attempts,
			JSON.stringify(value.facts),
			value.url
		]
	);
}

async function createFixtureSchema(dataSourceValue: DataSource): Promise<void> {
	await dataSourceValue.query(`
		create table history_archive_object_queue (
			"remoteId" uuid primary key,
			"objectType" text not null,
			"objectKey" text not null,
			"checkpointLedger" integer,
			status text not null,
			attempts integer not null,
			"verificationFacts" jsonb,
			"objectUrl" text not null
		);
		create table parsed_ledger_header (
			id integer primary key,
			"ledgerSequence" integer not null,
			"ledgerHeaderHash" text not null,
			"previousLedgerHeaderHash" text not null,
			"transactionSetHash" text not null,
			"transactionResultHash" text not null,
			"bucketListHash" text not null,
			"protocolVersion" integer not null
		);
		create table history_archive_object_ready (
			"objectRemoteId" uuid primary key references history_archive_object_queue("remoteId"),
			"dispatchToken" uuid,
			"claimAttempt" integer,
			"publishedAt" timestamptz
		);
		create table parsed_ledger_header_observation (
			"parsedLedgerHeaderId" integer not null,
			"sourceObjectRemoteId" text not null,
			"observedAt" timestamptz not null,
			"closedAt" timestamptz,
			unique ("parsedLedgerHeaderId", "sourceObjectRemoteId")
		);
		create table parsed_transaction_envelope_observation (
			"parsedTransactionEnvelopeId" integer not null,
			"sourceObjectRemoteId" text not null,
			"observedAt" timestamptz not null,
			unique ("parsedTransactionEnvelopeId", "sourceObjectRemoteId")
		);
		create table parsed_transaction_result_observation (
			"parsedTransactionResultId" integer not null,
			"sourceObjectRemoteId" text not null,
			"observedAt" timestamptz not null,
			unique ("parsedTransactionResultId", "sourceObjectRemoteId")
		)
	`);
}

async function runMigration(dataSourceValue: DataSource): Promise<void> {
	const runner = dataSourceValue.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await new HistoryArchiveContentReuseMigration1785520000000().up(
			runner as QueryRunner
		);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}
