import { createHash, randomUUID } from 'node:crypto';
import { DataSource, type MigrationInterface } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryLedgerProjection } from '../../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../../migrations/1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';
import { FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000 } from '../../migrations/1785140000000-FullHistoryLedgerCloseMetaCanonicalCoverageMigration.js';
import { FullHistoryCurrentProofCoverageMigration1785190000000 } from '../../migrations/1785190000000-FullHistoryCurrentProofCoverageMigration.js';
import {
	insertCanonicalBatchFixture,
	type CanonicalProofFixture
} from './FullHistoryStateCanonicalCoverageFixture.js';
import { TypeOrmFullHistoryStateCanonicalCoverageRepository } from '../TypeOrmFullHistoryStateCanonicalCoverageRepository.js';

jest.setTimeout(60_000);

describe('TypeOrmFullHistoryStateCanonicalCoverageRepository', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryStateCanonicalCoverageRepository;
	const batchId = randomUUID();
	const mismatchBatchId = randomUUID();
	const canonicalBatchId = randomUUID();
	const canonicalSecondBatchId = randomUUID();
	const mismatchCanonicalBatchId = randomUUID();
	const workerId = randomUUID();
	const networkPassphrase = 'Test SDF Network ; September 2015';
	const networkHash = createHash('sha256').update(networkPassphrase).digest();
	let firstCanonicalFixture: CanonicalProofFixture;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createParentSchema();
		await runMigration(
			new FullHistoryLedgerCloseMetaStateImportMigration1785130000000()
		);
		await runMigration(
			new FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000()
		);
		await runMigration(
			new FullHistoryCurrentProofCoverageMigration1785190000000()
		);
		repository = new TypeOrmFullHistoryStateCanonicalCoverageRepository(
			dataSource
		);
		await insertCompleteStateImports(batchId);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('waits for canonical proof rows, then records exact immutable coverage', async () => {
		const registrations = await Promise.all(
			Array.from({ length: 4 }, () => repository.registerPendingCoverage())
		);
		expect(registrations.reduce((sum, count) => sum + count, 0)).toBe(1);
		await expect(repository.claimNext(workerId, 30_000)).resolves.toBeNull();

		await insertCanonicalRows();
		await expect(repository.claimNext(workerId, 30_000)).resolves.toBeNull();
		await dataSource.query(
			`update "history_archive_checkpoint_proof" proof
			 set "proofVersion" = 6,
				"evaluatedAt" = $3::timestamptz + interval '0.000456 seconds'
			 from "full_history_ingestion_batch" batch
			 where proof.id = batch."checkpoint_proof_id"
				and batch.id in ($1, $2)`,
			[canonicalBatchId, canonicalSecondBatchId, proofTime]
		);
		await dataSource.query(
			`update "history_archive_object_queue"
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{content,digest}', to_jsonb($2::text)
			 ) where "remoteId" = $1`,
			[firstCanonicalFixture.ledgerRemoteId, 'f'.repeat(64)]
		);
		await expect(repository.claimNext(workerId, 30_000)).resolves.toBeNull();
		await dataSource.query(
			`update "history_archive_object_queue"
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{content,digest}', to_jsonb($2::text)
			 ) where "remoteId" = $1`,
			[
				firstCanonicalFixture.ledgerRemoteId,
				firstCanonicalFixture.ledgerDigest.toString('hex')
			]
		);
		const stale = await repository.claimNext(workerId, 30_000);
		expect(stale).toEqual(
			expect.objectContaining({
				attemptCount: 1,
				batchId,
				expectedLedgerCount: 64,
				startLedger: 1,
				endLedger: 64
			})
		);
		if (stale === null) throw new Error('Expected canonical coverage claim');
		await dataSource.query(
			`update "full_history_lcm_state_canonical_coverage"
			 set "lease_expires_at" = clock_timestamp() - interval '1 second'
			 where "batch_id" = $1`,
			[batchId]
		);
		const claim = await repository.claimNext(workerId, 30_000);
		if (claim === null) throw new Error('Expected reclaimed coverage claim');
		expect(claim.attemptCount).toBe(2);
		await expect(repository.renewLease(stale, 30_000)).rejects.toThrow(/lost/i);
		await expect(
			repository.storeLedgerRows(stale, [ledgerRows()[0]!])
		).rejects.toThrow(/lost/i);
		await expect(repository.complete(stale, 64n)).rejects.toThrow(/lease/i);
		await expect(repository.fail(stale, new Error('stale'))).rejects.toThrow(
			/lost/i
		);

		const expectedRows = ledgerRows();
		await repository.storeLedgerRows(claim, expectedRows);
		await expect(
			repository.storeLedgerRows(claim, [
				{ ...expectedRows[0]!, ledgerHash: 'f'.repeat(64) }
			])
		).rejects.toThrow(/differ from exported evidence/i);
		await expect(repository.complete(claim, 64n)).resolves.toEqual({
			batchId,
			canonicalBatchCount: 2,
			ledgerCount: 64,
			minimumProofVersion: 6,
			status: 'complete'
		});

		const [row] = await dataSource.query<CoverageRow[]>(
			`select "status", "matched_ledger_count" as "matchedLedgerCount",
				(select count(*)::integer
				 from "full_history_lcm_state_canonical_batch_link" link
				 where link."lcm_batch_id" = coverage."batch_id") as "linkCount"
			 from "full_history_lcm_state_canonical_coverage" coverage
			 where "batch_id" = $1`,
			[batchId]
		);
		expect(row).toEqual({
			linkCount: 2,
			matchedLedgerCount: 64,
			status: 'complete'
		});
	});

	it('records a terminal mismatch instead of exposing divergent state', async () => {
		await insertMismatchBatch();
		await expect(repository.registerPendingCoverage()).resolves.toBe(1);
		const claim = await repository.claimNext(workerId, 30_000);
		if (claim === null) throw new Error('Expected mismatch coverage claim');
		expect(claim.batchId).toBe(mismatchBatchId);
		await repository.storeLedgerRows(claim, ledgerRows(65));
		await expect(repository.complete(claim, 64n)).resolves.toEqual({
			batchId: mismatchBatchId,
			canonicalBatchCount: 2,
			ledgerCount: 63,
			minimumProofVersion: 6,
			status: 'mismatch'
		});
		const [row] = await dataSource.query<
			Array<{
				readonly matchedLedgerCount: number;
				readonly status: string;
			}>
		>(
			`select "status", "matched_ledger_count" as "matchedLedgerCount"
			 from "full_history_lcm_state_canonical_coverage"
			 where "batch_id" = $1`,
			[mismatchBatchId]
		);
		expect(row).toEqual({ matchedLedgerCount: 63, status: 'failed' });
	});

	async function createParentSchema(): Promise<void> {
		await dataSource.query(`
			create extension if not exists pgcrypto;
			create table "history_archive_object_queue" (
				"remoteId" uuid primary key,
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"objectType" text not null,
				"status" text not null,
				"verificationFacts" jsonb not null
			);
			create table "history_archive_checkpoint_proof" (
				"id" bigserial primary key,
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"status" text not null,
				"proofVersion" smallint not null,
				"requiredObjectsComplete" boolean not null,
				"proofFactsComplete" boolean not null,
				"checkpointBucketListMatches" boolean not null,
				"transactionsMatch" boolean not null,
				"resultsMatch" boolean not null,
				"previousLedgersMatch" boolean not null,
				"bucketsVerified" boolean not null,
				"ledgerFactCount" integer not null,
				"transactionFactCount" integer not null,
				"resultFactCount" integer not null,
				"checkpointStateObjectRemoteId" uuid not null,
				"ledgerObjectRemoteId" uuid not null,
				"transactionsObjectRemoteId" uuid not null,
				"resultsObjectRemoteId" uuid not null,
				"failureKind" text,
				"details" jsonb not null,
				"evaluatedAt" timestamptz not null
			);
			create table "full_history_ledger_close_meta_batch" (
				"id" uuid not null, "network_passphrase_hash" bytea not null,
				"start_ledger" bigint not null, "end_ledger" bigint not null,
				"ledger_count" integer not null,
				primary key ("id"), unique ("id", "network_passphrase_hash")
			);
			create table "full_history_ledger_close_meta_dataset" (
				"batch_id" uuid not null, "dataset" text not null,
				"storage_key" text not null, "output_sha256" bytea not null,
				"record_count" bigint not null,
				primary key ("batch_id", "dataset")
			);
			create table "full_history_ingestion_batch" (
				"id" uuid not null, "network_passphrase_hash" bytea not null,
				"checkpoint_proof_id" bigint not null,
				"proof_version" smallint not null,
				"proof_evaluated_at" timestamptz not null,
				"archive_url_identity" text not null,
				"checkpoint_ledger" bigint not null,
				"first_ledger" bigint not null, "last_ledger" bigint not null,
				"checkpoint_state_object_remote_id" uuid not null,
				"checkpoint_state_content_digest" bytea not null,
				"ledger_object_remote_id" uuid not null,
				"ledger_content_digest" bytea not null,
				"transactions_object_remote_id" uuid not null,
				"transactions_content_digest" bytea not null,
				"results_object_remote_id" uuid not null,
				"results_content_digest" bytea not null,
				primary key ("id"), unique ("id", "network_passphrase_hash")
			);
			create table "full_history_ledger" (
				"network_passphrase_hash" bytea not null,
				"ledger_sequence" bigint not null, "batch_id" uuid not null,
				"ledger_hash" bytea not null, "previous_ledger_hash" bytea not null,
				"transaction_set_hash" bytea not null,
				"transaction_result_hash" bytea not null,
				"bucket_list_hash" bytea not null, "protocol_version" integer not null,
				"closed_at" timestamptz not null, "transaction_count" integer not null,
				primary key ("network_passphrase_hash", "ledger_sequence")
			)
		`);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_batch" values ($1, $2, 1, 64, 64)`,
			[batchId, networkHash]
		);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_dataset" values
			 ($1, 'ledgers', 'pubnet/ledgers.parquet', $2, 64),
			 ($1, 'account-state-changes', 'pubnet/accounts.parquet', $3, 0),
			 ($1, 'trustline-state-changes', 'pubnet/trustlines.parquet', $4, 0)`,
			[
				batchId,
				Buffer.alloc(32, 12),
				Buffer.alloc(32, 13),
				Buffer.alloc(32, 14)
			]
		);
		firstCanonicalFixture = await insertCanonicalBatchFixture(dataSource, {
			batchId: canonicalBatchId,
			checkpointLedger: 63,
			firstLedger: 1,
			label: 'canonical-first',
			lastLedger: 63,
			networkHash,
			networkPassphrase,
			proofTime,
			proofVersion: 5
		});
		await insertCanonicalBatchFixture(dataSource, {
			batchId: canonicalSecondBatchId,
			checkpointLedger: 127,
			firstLedger: 64,
			label: 'canonical-second',
			lastLedger: 127,
			networkHash,
			networkPassphrase,
			proofTime,
			proofVersion: 5
		});
	}

	async function insertCanonicalRows(): Promise<void> {
		await dataSource.query(
			`insert into "full_history_ledger" (
				"network_passphrase_hash", "ledger_sequence", "batch_id",
				"ledger_hash", "previous_ledger_hash", "transaction_set_hash",
				"transaction_result_hash", "bucket_list_hash", "protocol_version",
				"closed_at", "transaction_count"
			) select $1, sequence,
				case when sequence <= 63 then $2::uuid else $3::uuid end,
				digest(sequence::text || ':ledger', 'sha256'),
				digest(sequence::text || ':previous', 'sha256'),
				digest(sequence::text || ':txset', 'sha256'),
				digest(sequence::text || ':result', 'sha256'),
				digest(sequence::text || ':bucket', 'sha256'), 27,
				$4::timestamptz + sequence * interval '5 seconds', 0
			 from generate_series(1, 64) sequence`,
			[networkHash, canonicalBatchId, canonicalSecondBatchId, proofTime]
		);
	}

	async function insertMismatchBatch(): Promise<void> {
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_batch" values ($1, $2, 65, 128, 64)`,
			[mismatchBatchId, networkHash]
		);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_dataset" values
			 ($1, 'ledgers', 'pubnet/ledgers-65-128.parquet', $2, 64),
			 ($1, 'account-state-changes', 'pubnet/accounts-65-128.parquet', $3, 0),
			 ($1, 'trustline-state-changes', 'pubnet/trustlines-65-128.parquet', $4, 0)`,
			[
				mismatchBatchId,
				Buffer.alloc(32, 15),
				Buffer.alloc(32, 16),
				Buffer.alloc(32, 17)
			]
		);
		await insertCompleteStateImports(mismatchBatchId);
		await insertCanonicalBatchFixture(dataSource, {
			batchId: mismatchCanonicalBatchId,
			checkpointLedger: 191,
			firstLedger: 128,
			label: 'canonical-mismatch',
			lastLedger: 191,
			networkHash,
			networkPassphrase,
			proofTime,
			proofVersion: 6
		});
		await dataSource.query(
			`insert into "full_history_ledger" (
				"network_passphrase_hash", "ledger_sequence", "batch_id",
				"ledger_hash", "previous_ledger_hash", "transaction_set_hash",
				"transaction_result_hash", "bucket_list_hash", "protocol_version",
				"closed_at", "transaction_count"
			) select $1, sequence,
				case when sequence <= 127 then $2::uuid else $3::uuid end,
				case when sequence = 100 then digest('wrong', 'sha256')
					else digest(sequence::text || ':ledger', 'sha256') end,
				digest(sequence::text || ':previous', 'sha256'),
				digest(sequence::text || ':txset', 'sha256'),
				digest(sequence::text || ':result', 'sha256'),
				digest(sequence::text || ':bucket', 'sha256'), 27,
				$4::timestamptz + sequence * interval '5 seconds', 0
			 from generate_series(65, 128) sequence`,
			[networkHash, canonicalSecondBatchId, mismatchCanonicalBatchId, proofTime]
		);
	}

	async function insertCompleteStateImports(
		targetBatchId: string
	): Promise<void> {
		await dataSource.query(
			`insert into "full_history_lcm_state_import" (
				"batch_id", "dataset", "source_path", "source_sha256",
				"expected_record_count", "imported_record_count",
				"imported_row_set_sha256", "status", "completed_at"
			) select dataset."batch_id", dataset."dataset", dataset."storage_key",
				dataset."output_sha256", dataset."record_count", dataset."record_count",
				digest('', 'sha256'), 'complete', clock_timestamp()
			 from "full_history_ledger_close_meta_dataset" dataset
			 where dataset."batch_id" = $1 and dataset."dataset" in (
				'account-state-changes', 'trustline-state-changes'
			)`,
			[targetBatchId]
		);
	}

	async function runMigration(target: MigrationInterface): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await target.up(runner);
			await runner.commitTransaction();
		} catch (error) {
			await runner.rollbackTransaction();
			throw error;
		} finally {
			await runner.release();
		}
	}
});

const proofTime = new Date('2026-07-15T00:00:00Z');

function ledgerRows(start = 1): FullHistoryLedgerProjection[] {
	return Array.from({ length: 64 }, (_, index) => {
		const sequence = start + index;
		return {
			bucketListHash: hash(`${sequence}:bucket`),
			closedAtUnixMillis: String(proofTime.getTime() + sequence * 5_000),
			ledgerHash: hash(`${sequence}:ledger`),
			ledgerSequence: String(sequence),
			previousLedgerHash: hash(`${sequence}:previous`),
			protocolVersion: 27,
			transactionCount: '0',
			transactionResultSetHash: hash(`${sequence}:result`),
			transactionSetHash: hash(`${sequence}:txset`)
		};
	});
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

interface CoverageRow {
	readonly linkCount: number;
	readonly matchedLedgerCount: number;
	readonly status: string;
}
