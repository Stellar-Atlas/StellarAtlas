import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexes = [
	{
		name: 'idx_full_history_batch_checkpoint_object_remote',
		table: 'full_history_ingestion_batch',
		column: 'checkpoint_state_object_remote_id'
	},
	{
		name: 'idx_full_history_batch_ledger_object_remote',
		table: 'full_history_ingestion_batch',
		column: 'ledger_object_remote_id'
	},
	{
		name: 'idx_full_history_batch_transactions_object_remote',
		table: 'full_history_ingestion_batch',
		column: 'transactions_object_remote_id'
	},
	{
		name: 'idx_full_history_batch_results_object_remote',
		table: 'full_history_ingestion_batch',
		column: 'results_object_remote_id'
	},
	{
		name: 'idx_history_archive_content_artifact_source_object_remote',
		table: 'history_archive_content_artifact',
		column: 'sourceObjectRemoteId'
	}
] as const;

export class HistoryArchiveObjectReferenceIndexesMigration1785550000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveObjectReferenceIndexesMigration1785550000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		for (const index of indexes) {
			await queryRunner.query(
				`create index concurrently if not exists "${index.name}" on "${index.table}" ("${index.column}")`
			);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const index of [...indexes].reverse()) {
			await queryRunner.query(
				`drop index concurrently if exists "${index.name}"`
			);
		}
	}
}
