import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointLedgerBindingMigration1785060000000 } from '../1785060000000-HistoryArchiveCheckpointLedgerBindingMigration.js';

jest.setTimeout(90_000);

describe('HistoryArchiveCheckpointLedgerBindingMigration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createFixtureSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('runs outside a long-lived migration transaction', () => {
		expect(
			new HistoryArchiveCheckpointLedgerBindingMigration1785060000000()
				.transaction
		).toBe(false);
	});

	it('reclassifies missing and mismatched state facts without discarding rows', async () => {
		const runner = dataSource.createQueryRunner();
		await new HistoryArchiveCheckpointLedgerBindingMigration1785060000000().up(
			runner
		);
		await runner.release();

		const rows = await dataSource.query<
			Array<{
				readonly details: Record<string, unknown>;
				readonly failureKind: string | null;
				readonly proofFactsComplete: boolean;
				readonly proofVersion: number;
				readonly status: string;
			}>
		>(
			`select status, "proofVersion", "proofFactsComplete", "failureKind", details
			 from history_archive_checkpoint_proof order by id`
		);

		expect(rows).toEqual([
			expect.objectContaining({
				details: expect.objectContaining({
					checkpointStateLedgerFactPresent: true,
					checkpointStateLedgerMatches: true
				}),
				failureKind: null,
				proofFactsComplete: true,
				proofVersion: 6,
				status: 'verified'
			}),
			expect.objectContaining({
				failureKind: 'object-failed',
				proofFactsComplete: false,
				proofVersion: 6,
				status: 'not-evaluable'
			}),
			expect.objectContaining({
				failureKind: 'proof-facts-incomplete',
				proofFactsComplete: false,
				proofVersion: 6,
				status: 'not-evaluable'
			}),
			expect.objectContaining({
				failureKind: 'object-incomplete',
				proofFactsComplete: false,
				proofVersion: 5,
				status: 'pending'
			})
		]);
		await expect(
			dataSource.query(
				`select status, "errorType", "failureChannel", "errorMessage"
				 from history_archive_object_queue where "remoteId" = $1`,
				['00000000-0000-4000-8000-000000000002']
			)
		).resolves.toEqual([
			expect.objectContaining({
				errorMessage: 'Checkpoint state declares ledger 191; expected 127',
				errorType: 'checkpoint_state_ledger_mismatch',
				failureChannel: 'archive_evidence',
				status: 'failed'
			})
		]);
		await expect(
			dataSource.query(
				`update history_archive_checkpoint_proof
				 set "failureKind" = 'unclassified-failure' where id = 1`
			)
		).rejects.toThrow();
	});

	it('refuses to invalidate proof evidence referenced by a canonical batch', async () => {
		const stateId = '00000000-0000-4000-8000-000000000005';
		await dataSource.query(
			`insert into history_archive_object_queue
			 ("remoteId", "objectType", status, "verificationFacts")
			 values ($1, 'checkpoint-state', 'verified', $2::jsonb)`,
			[
				stateId,
				JSON.stringify({
					checkpointHistoryArchiveStateFact: { checkpointLedger: 191 }
				})
			]
		);
		const proofRows = (await dataSource.query(
			`insert into history_archive_checkpoint_proof
			 ("checkpointLedger", "checkpointStateObjectRemoteId", status,
			  "proofVersion", "proofFactsComplete", "failureKind", details)
			 values (127, $1, 'verified', 5, true, null, '{}'::jsonb)
			 returning id`,
			[stateId]
		)) as readonly { readonly id: number }[];
		const proofId = proofRows[0]!.id;
		await dataSource.query(
			`insert into full_history_ingestion_batch
			 (id, "checkpoint_proof_id") values ($1, $2)`,
			['00000000-0000-4000-8000-000000000099', proofId]
		);
		const runner = dataSource.createQueryRunner();
		try {
			await expect(
				new HistoryArchiveCheckpointLedgerBindingMigration1785060000000().up(
					runner
				)
			).rejects.toThrow(/canonical full-history batches/i);
		} finally {
			await runner.release();
		}
		await expect(
			dataSource.query(
				`select status, "proofVersion" from history_archive_checkpoint_proof
				 where id = $1`,
				[proofId]
			)
		).resolves.toEqual([{ proofVersion: 5, status: 'verified' }]);
		await dataSource.query(
			'delete from full_history_ingestion_batch where "checkpoint_proof_id" = $1',
			[proofId]
		);
		await dataSource.query(
			'delete from history_archive_checkpoint_proof where id = $1',
			[proofId]
		);
		await dataSource.query(
			'delete from history_archive_object_queue where "remoteId" = $1',
			[stateId]
		);
	});

	it('fails fast instead of waiting behind a conflicting table lock', async () => {
		const blocker = dataSource.createQueryRunner();
		const migrationRunner = dataSource.createQueryRunner();
		await blocker.startTransaction();
		try {
			await blocker.query(
				'lock table history_archive_checkpoint_proof in access share mode'
			);
			const startedAt = Date.now();
			await expect(
				new HistoryArchiveCheckpointLedgerBindingMigration1785060000000().up(
					migrationRunner
				)
			).rejects.toMatchObject({ code: '55P03' });
			expect(Date.now() - startedAt).toBeLessThan(10_000);
		} finally {
			await blocker.rollbackTransaction();
			await blocker.release();
			await migrationRunner.release();
		}
	});
});

async function createFixtureSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table history_archive_object_queue (
			"remoteId" uuid primary key,
			"objectType" text not null,
			status text not null,
			"verificationFacts" jsonb,
			"verifiedAt" timestamptz,
			"workerStage" text,
			"errorType" text,
			"errorMessage" text,
			"failureChannel" text,
			"httpStatus" integer,
			"nextAttemptAt" timestamptz,
			"claimedAt" timestamptz,
			"claimedByCommunityScannerId" uuid,
			"transitionEffectsCompletedAt" timestamptz,
			"transitionEffectsRequiredAt" timestamptz,
			"updatedAt" timestamptz not null default now()
		);
		create table history_archive_checkpoint_proof (
			id serial primary key,
			"checkpointLedger" integer not null,
			"checkpointStateObjectRemoteId" uuid,
			status text not null,
			"proofVersion" smallint not null,
			"proofFactsComplete" boolean not null,
			"failureKind" text,
			details jsonb,
			"evaluatedAt" timestamptz not null default now(),
			"updatedAt" timestamptz not null default now(),
			constraint "CHK_history_archive_checkpoint_proof_failure" check (
				"failureKind" is null or "failureKind" in (
					'object-incomplete', 'object-failed', 'proof-facts-incomplete',
					'checkpoint-bucket-list-mismatch', 'transaction-hash-mismatch',
					'result-hash-mismatch', 'previous-ledger-hash-mismatch',
					'predecessor-missing', 'bucket-missing'
				)
			)
		);
		create table full_history_ingestion_batch (
			id uuid primary key,
			"checkpoint_proof_id" integer not null
		)
	`);
	await dataSource.query(
		`insert into history_archive_object_queue
			("remoteId", "objectType", status, "verificationFacts") values
			($1, 'checkpoint-state', 'verified', $4::jsonb),
			($2, 'checkpoint-state', 'verified', $5::jsonb),
			($3, 'checkpoint-state', 'verified', '{}'::jsonb)`,
		[
			'00000000-0000-4000-8000-000000000001',
			'00000000-0000-4000-8000-000000000002',
			'00000000-0000-4000-8000-000000000003',
			JSON.stringify({
				checkpointHistoryArchiveStateFact: { checkpointLedger: 127 }
			}),
			JSON.stringify({
				checkpointHistoryArchiveStateFact: { checkpointLedger: 191 }
			})
		]
	);
	await dataSource.query(
		`insert into history_archive_checkpoint_proof
			("checkpointLedger", "checkpointStateObjectRemoteId", status,
			 "proofVersion", "proofFactsComplete", "failureKind", details) values
			(127, $1, 'verified', 5, true, null, null),
			(127, $2, 'verified', 5, true, null, '{}'::jsonb),
			(127, $3, 'verified', 5, true, null, '{}'::jsonb),
			(127, $1, 'pending', 5, false, 'object-incomplete', '{}'::jsonb)`,
		[
			'00000000-0000-4000-8000-000000000001',
			'00000000-0000-4000-8000-000000000002',
			'00000000-0000-4000-8000-000000000003'
		]
	);
}
