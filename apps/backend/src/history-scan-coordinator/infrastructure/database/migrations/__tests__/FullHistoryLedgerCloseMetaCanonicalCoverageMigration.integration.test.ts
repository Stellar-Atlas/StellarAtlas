import { randomUUID } from 'node:crypto';
import { DataSource, type MigrationInterface } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';
import { FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000 } from '../1785140000000-FullHistoryLedgerCloseMetaCanonicalCoverageMigration.js';
import { hardenFullHistoryStateImportEvidenceSql } from '../FullHistoryStateImportEvidenceSchemaSql.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	const batchId = randomUUID();
	const canonicalBatchId = randomUUID();
	const canonicalSecondBatchId = randomUUID();
	const networkHash = Buffer.alloc(32, 7);
	const ledgerSourceHash = Buffer.alloc(32, 8);
	const coverageOwner = randomUUID();
	const migration =
		new FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000();

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createParentSchema();
		await runMigration(
			new FullHistoryLedgerCloseMetaStateImportMigration1785130000000(),
			'up'
		);
		await runMigration(migration, 'up');
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('binds complete state imports only to matching proof-gated ledgers', async () => {
		await expect(
			dataSource.query(
				`insert into "full_history_lcm_state_import" (
					"batch_id", "dataset", "source_path", "source_sha256",
					"expected_record_count"
				) values ($1, 'account-state-changes',
					'pubnet/range=1-64/accounts.parquet', $2, 1)`,
				[batchId, Buffer.alloc(32, 9)]
			)
		).rejects.toThrow(/immutable dataset manifest/i);
		await insertCoverageFixture();
		await expect(markComplete()).rejects.toThrow(/does not match canonical/i);

		await insertCanonicalLedgers();
		await markComplete();

		const [coverage] = await dataSource.query<CoverageRow[]>(`
			select "status", "matched_ledger_count" as "matchedLedgerCount",
				"minimum_proof_version" as "minimumProofVersion",
				"completed_at" is not null as "completed"
			from "full_history_lcm_state_canonical_coverage"
			where "batch_id" = '${batchId}'
		`);
		expect(coverage).toEqual({
			completed: true,
			matchedLedgerCount: 64,
			minimumProofVersion: 6,
			status: 'complete'
		});
	});

	it('freezes terminal coverage, source projections, links, and canonical ledgers', async () => {
		await expect(
			dataSource.query(
				`update "full_history_lcm_state_canonical_coverage"
				 set "updated_at" = clock_timestamp() where "batch_id" = $1`,
				[batchId]
			)
		).rejects.toThrow(/terminal.*immutable/i);
		for (const table of [
			'full_history_lcm_ledger_projection',
			'full_history_lcm_state_canonical_batch_link'
		]) {
			await expect(dataSource.query(`delete from "${table}"`)).rejects.toThrow(
				/immutable/i
			);
		}
		await expect(
			dataSource.query(
				`update "full_history_ledger" set "transaction_count" = 1
				 where "ledger_sequence" = 1`
			)
		).rejects.toThrow(/canonical.*immutable/i);
	});

	it('refuses destructive downgrade when durable evidence exists', async () => {
		await expect(runMigration(migration, 'down')).rejects.toThrow(
			/cannot downgrade.*durable rows/i
		);
	});

	it('upgrades a legacy zero-row complete import without deleting its evidence', async () => {
		const legacyPostgres = await startDisposablePostgres();
		const legacyDataSource = new DataSource({
			type: 'postgres',
			url: legacyPostgres.url
		});
		const legacyBatchId = randomUUID();
		try {
			await legacyDataSource.initialize();
			await legacyDataSource.query(`
				create extension if not exists pgcrypto;
				create table "full_history_ledger_close_meta_batch" (
					"id" uuid not null primary key,
					"start_ledger" bigint not null, "end_ledger" bigint not null
				);
				create table "full_history_ledger_close_meta_dataset" (
					"batch_id" uuid not null, "dataset" text not null,
					"storage_key" text not null, "output_sha256" bytea not null,
					"record_count" bigint not null,
					primary key ("batch_id", "dataset")
				);
				create table "full_history_ingestion_batch" (
					"id" uuid not null, "network_passphrase_hash" bytea not null,
					"first_ledger" bigint not null, "last_ledger" bigint not null,
					primary key ("id", "network_passphrase_hash")
				);
				create table "full_history_ledger" (
					"batch_id" uuid not null, "network_passphrase_hash" bytea not null,
					"ledger_sequence" bigint not null
				)
			`);
			await legacyDataSource.query(
				`insert into "full_history_ledger_close_meta_batch"
				 ("id", "start_ledger", "end_ledger") values ($1, 1, 63)`,
				[legacyBatchId]
			);
			await legacyDataSource.query(
				`insert into "full_history_ledger_close_meta_dataset"
				 ("batch_id", "dataset", "storage_key", "output_sha256", "record_count")
				 values ($1, 'account-state-changes', 'legacy/accounts.parquet', $2, 0)`,
				[legacyBatchId, Buffer.alloc(32, 21)]
			);
			await runMigrationFor(
				legacyDataSource,
				new FullHistoryLedgerCloseMetaStateImportMigration1785130000000(),
				'up'
			);
			await legacyDataSource.query(
				`insert into "full_history_lcm_state_import" (
					"batch_id", "dataset", "source_path", "source_sha256",
					"expected_record_count", "imported_record_count", "status",
					"completed_at"
				) values ($1, 'account-state-changes', 'legacy/accounts.parquet',
					$2, 0, 0, 'complete', clock_timestamp())`,
				[legacyBatchId, Buffer.alloc(32, 21)]
			);

			await runSqlFor(
				legacyDataSource,
				hardenFullHistoryStateImportEvidenceSql
			);
			const [preserved] = await legacyDataSource.query<
				Array<{
					readonly rowCount: string;
					readonly rowSetSha256: string;
					readonly status: string;
				}>
			>(
				`select "status", count(*) over ()::text as "rowCount",
					encode("imported_row_set_sha256", 'hex') as "rowSetSha256"
				 from "full_history_lcm_state_import" where "batch_id" = $1
				`,
				[legacyBatchId]
			);
			expect(preserved).toEqual({
				rowCount: '1',
				rowSetSha256:
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				status: 'complete'
			});
			await expect(
				legacyDataSource.query(
					`update "full_history_lcm_state_import"
					 set "updated_at" = clock_timestamp() where "batch_id" = $1`,
					[legacyBatchId]
				)
			).rejects.toThrow(/completed.*immutable/i);
		} finally {
			if (legacyDataSource.isInitialized) await legacyDataSource.destroy();
			await legacyPostgres.stop();
		}
	});

	async function createParentSchema(): Promise<void> {
		await dataSource.query(`
			create extension if not exists pgcrypto;
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
				"proof_version" smallint not null,
				"proof_evaluated_at" timestamptz not null,
				"first_ledger" bigint not null, "last_ledger" bigint not null,
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
			`insert into "full_history_ledger_close_meta_batch"
			 ("id", "network_passphrase_hash", "start_ledger", "end_ledger", "ledger_count")
			 values ($1, $2, 1, 64, 64)`,
			[batchId, networkHash]
		);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_dataset"
			 ("batch_id", "dataset", "storage_key", "output_sha256", "record_count")
			 values
			 ($1, 'ledgers', 'pubnet/range=1-64/ledgers.parquet', $2, 64),
			 ($1, 'account-state-changes', 'pubnet/range=1-64/accounts.parquet', $3, 0),
			 ($1, 'trustline-state-changes', 'pubnet/range=1-64/trustlines.parquet', $4, 0)`,
			[batchId, ledgerSourceHash, Buffer.alloc(32, 9), Buffer.alloc(32, 10)]
		);
		await dataSource.query(
			`insert into "full_history_ingestion_batch"
			 ("id", "network_passphrase_hash", "proof_version", "proof_evaluated_at",
			  "first_ledger", "last_ledger") values
			 ($1, $3, 6, '2026-07-15T00:00:00Z', 1, 63),
			 ($2, $3, 6, '2026-07-15T00:00:00Z', 64, 127)`,
			[canonicalBatchId, canonicalSecondBatchId, networkHash]
		);
	}

	async function insertCoverageFixture(): Promise<void> {
		await dataSource.query(
			`insert into "full_history_lcm_state_canonical_coverage" (
				"batch_id", "network_passphrase_hash", "ledger_source_path",
				"ledger_source_sha256", "expected_ledger_count", "status",
				"lease_owner", "lease_expires_at"
			) values ($1, $2, 'pubnet/range=1-64/ledgers.parquet', $3, 64,
				'checking', $4, clock_timestamp() + interval '5 minutes')`,
			[batchId, networkHash, ledgerSourceHash, coverageOwner]
		);
		await dataSource.query(
			`insert into "full_history_lcm_state_import" (
				"batch_id", "dataset", "source_path", "source_sha256",
				"expected_record_count", "imported_record_count",
				"imported_row_set_sha256", "status", "completed_at"
			) values
			 ($1, 'account-state-changes', 'pubnet/range=1-64/accounts.parquet',
				$2, 0, 0, digest('', 'sha256'), 'complete', clock_timestamp()),
			 ($1, 'trustline-state-changes', 'pubnet/range=1-64/trustlines.parquet',
				$3, 0, 0, digest('', 'sha256'), 'complete', clock_timestamp())`,
			[batchId, Buffer.alloc(32, 9), Buffer.alloc(32, 10)]
		);
		await dataSource.query(
			`insert into "full_history_lcm_ledger_projection" (
				"batch_id", "ledger_sequence", "ledger_hash", "previous_ledger_hash",
				"transaction_set_hash", "transaction_result_hash", "bucket_list_hash",
				"protocol_version", "closed_at", "transaction_count"
			) select $1, sequence, digest(sequence::text || ':ledger', 'sha256'),
				digest(sequence::text || ':previous', 'sha256'),
				digest(sequence::text || ':txset', 'sha256'),
				digest(sequence::text || ':result', 'sha256'),
				digest(sequence::text || ':bucket', 'sha256'), 27,
				'2026-07-15T00:00:00Z'::timestamptz + sequence * interval '5 seconds', 0
			 from generate_series(1, 64) sequence`,
			[batchId]
		);
		await dataSource.query(
			`insert into "full_history_lcm_state_canonical_batch_link"
			 ("lcm_batch_id", "canonical_batch_id", "network_passphrase_hash") values
			 ($1, $2, $4), ($1, $3, $4)`,
			[batchId, canonicalBatchId, canonicalSecondBatchId, networkHash]
		);
	}

	async function insertCanonicalLedgers(): Promise<void> {
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
				'2026-07-15T00:00:00Z'::timestamptz + sequence * interval '5 seconds', 0
			 from generate_series(1, 64) sequence`,
			[networkHash, canonicalBatchId, canonicalSecondBatchId]
		);
	}

	async function markComplete(): Promise<void> {
		await dataSource.query(
			`update "full_history_lcm_state_canonical_coverage"
			 set "status" = 'complete', "matched_ledger_count" = 64,
				"minimum_proof_version" = 6,
				"latest_proof_evaluated_at" = '2026-07-15T00:00:00Z',
				"completed_at" = clock_timestamp(), "updated_at" = clock_timestamp(),
				"lease_owner" = null, "lease_expires_at" = null
			 where "batch_id" = $1`,
			[batchId]
		);
	}

	async function runMigration(
		target: MigrationInterface,
		direction: 'down' | 'up'
	): Promise<void> {
		return runMigrationFor(dataSource, target, direction);
	}
});

async function runMigrationFor(
	dataSource: DataSource,
	target: MigrationInterface,
	direction: 'down' | 'up'
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await target[direction](runner);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}

async function runSqlFor(dataSource: DataSource, sql: string): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await runner.query(sql);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}

interface CoverageRow {
	readonly completed: boolean;
	readonly matchedLedgerCount: number;
	readonly minimumProofVersion: number;
	readonly status: string;
}
