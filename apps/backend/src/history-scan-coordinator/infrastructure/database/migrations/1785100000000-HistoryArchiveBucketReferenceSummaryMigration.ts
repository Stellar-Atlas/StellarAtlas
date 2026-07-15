import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	runArchiveBucketReferenceSummaryBackfill,
	type ArchiveBucketReferenceSummaryBackfillObserver
} from '../../repositories/database/HistoryArchiveBucketReferenceSummaryBackfill.js';

export class HistoryArchiveBucketReferenceSummaryMigration1785100000000 implements MigrationInterface {
	name = 'HistoryArchiveBucketReferenceSummaryMigration1785100000000';
	transaction = false;

	constructor(
		private readonly observer: ArchiveBucketReferenceSummaryBackfillObserver = {}
	) {}

	async up(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await assertGlobalHashIndex(queryRunner);
			await createTables(queryRunner);
			await runArchiveBucketReferenceSummaryBackfill(
				queryRunner,
				this.observer
			);
		});
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await queryRunner.startTransaction();
			try {
				await queryRunner.query(`
					drop trigger if exists
						"trg_history_archive_bucket_reference_summary"
					on history_archive_object_queue
				`);
				await queryRunner.query(`
					drop trigger if exists
						"trg_history_archive_bucket_reference_summary_truncate"
					on history_archive_object_queue
				`);
				await queryRunner.query(`drop function if exists
					refresh_history_archive_bucket_reference_summary()`);
				await queryRunner.query(`drop function if exists
					reset_history_archive_bucket_reference_summary()`);
				await queryRunner.query(`drop table if exists
					history_archive_bucket_reference_summary_progress`);
				await queryRunner.query(`drop table if exists
					history_archive_bucket_reference_summary`);
				await queryRunner.query(`drop table if exists
					history_archive_bucket_identity_summary`);
				await queryRunner.commitTransaction();
			} catch (error) {
				if (queryRunner.isTransactionActive) {
					await queryRunner.rollbackTransaction();
				}
				throw error;
			}
		});
	}
}

async function createTables(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		create table if not exists history_archive_bucket_identity_summary (
			"bucketHash" text not null,
			"referenceCount" bigint not null,
			"updatedAt" timestamptz not null default now(),
			primary key ("bucketHash"),
			check ("referenceCount" > 0)
		)
	`);
	await queryRunner.query(`
		create table if not exists history_archive_bucket_reference_summary (
			"archiveUrlIdentity" text not null,
			"bucketHash" text not null,
			"referenceCount" bigint not null,
			"updatedAt" timestamptz not null default now(),
			primary key ("archiveUrlIdentity", "bucketHash"),
			check ("referenceCount" > 0)
		)
	`);
	await queryRunner.query(`
		create table if not exists
			history_archive_bucket_reference_summary_progress (
			id smallint primary key check (id = 1),
			"cutoffBucketHash" text not null,
			"lastBucketHash" text not null,
			"complete" boolean not null default false,
			"completedAt" timestamptz,
			"updatedAt" timestamptz not null default now(),
			check ("lastBucketHash" <= "cutoffBucketHash"),
			check (
				("complete" = false and "completedAt" is null)
				or ("complete" = true and "completedAt" is not null)
			)
		)
	`);
}

async function assertGlobalHashIndex(queryRunner: QueryRunner): Promise<void> {
	const value: unknown = await queryRunner.query(`
		select coalesce(index_metadata.indisvalid and index_metadata.indisready, false)
			as ready
		from pg_index index_metadata
		where index_metadata.indexrelid =
			to_regclass('idx_history_archive_object_bucket_hash_global')
	`);
	if (!Array.isArray(value) || value[0]?.ready !== true) {
		throw new Error('Global archive bucket hash index is not ready');
	}
}

async function withMigrationLock(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	if (queryRunner.isTransactionActive) {
		throw new Error('Archive bucket reference migration requires mode none');
	}
	const value: unknown = await queryRunner.query(
		'select pg_try_advisory_lock(1785100000, -1) as acquired'
	);
	if (!Array.isArray(value) || value[0]?.acquired !== true) {
		throw new Error('Archive bucket reference migration is already running');
	}
	try {
		await operation();
	} finally {
		if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
		await queryRunner.query('select pg_advisory_unlock(1785100000, -1)');
	}
}
