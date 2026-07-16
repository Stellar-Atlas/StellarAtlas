import type { DataSource } from 'typeorm';
import {
	checkPostgresSchemaReadiness,
	type PostgresSchemaReadiness
} from '../PostgresSchemaReadiness.js';

export type FullHistoryLedgerCloseMetaSchemaReadiness = PostgresSchemaReadiness;

const requiredRelations = [
	'full_history_ledger_close_meta_source',
	'full_history_ledger_close_meta_batch',
	'full_history_ledger_close_meta_source_object',
	'full_history_ledger_close_meta_dataset',
	'full_history_ledger_close_meta_watermark',
	'full_history_watermark'
] as const;

const requiredColumns = [
	...relationColumns('full_history_ledger_close_meta_source', [
		'id',
		'network_passphrase_hash',
		'base_uri',
		'config_object_key',
		'config_digest',
		'config_generation',
		'config_version',
		'compression',
		'ledgers_per_batch',
		'batches_per_partition',
		'config_bytes',
		'config_json',
		'first_available_ledger',
		'observed_at'
	]),
	...relationColumns('full_history_ledger_close_meta_batch', [
		'id',
		'network_passphrase_hash',
		'source_id',
		'config_digest',
		'start_ledger',
		'end_ledger',
		'ledger_count',
		'first_previous_ledger_hash',
		'last_ledger_hash',
		'processing_manifest_sha256',
		'source_disposition',
		'processed_at'
	]),
	...relationColumns('full_history_ledger_close_meta_source_object', [
		'batch_id',
		'network_passphrase_hash',
		'source_index',
		'start_ledger',
		'end_ledger',
		'ledger_count',
		'source_object_key',
		'source_generation',
		'source_etag',
		'first_previous_ledger_hash',
		'last_ledger_hash',
		'compressed_sha256',
		'xdr_sha256',
		'compressed_bytes',
		'xdr_bytes'
	]),
	...relationColumns('full_history_ledger_close_meta_dataset', [
		'batch_id',
		'network_passphrase_hash',
		'dataset',
		'media_type',
		'representation',
		'schema_version',
		'record_count',
		'output_bytes',
		'output_sha256',
		'storage_key'
	]),
	...relationColumns('full_history_ledger_close_meta_watermark', [
		'network_passphrase_hash',
		'first_available_ledger',
		'next_ledger',
		'last_batch_id',
		'version',
		'updated_at'
	]),
	...relationColumns('full_history_watermark', [
		'network_passphrase_hash',
		'first_ledger',
		'next_ledger'
	])
] as const;

const requiredConstraints = [
	'pk_full_history_lcm_source',
	'uq_full_history_lcm_source_config',
	'uq_full_history_lcm_source_identity',
	'chk_full_history_lcm_source_hashes',
	'chk_full_history_lcm_source_text',
	'chk_full_history_lcm_source_shape',
	'pk_full_history_lcm_batch',
	'uq_full_history_lcm_batch_range',
	'uq_full_history_lcm_batch_identity',
	'fk_full_history_lcm_batch_source',
	'chk_full_history_lcm_batch_hashes',
	'chk_full_history_lcm_batch_range',
	'chk_full_history_lcm_batch_text',
	'pk_full_history_lcm_source_object',
	'uq_full_history_lcm_source_object_range',
	'uq_full_history_lcm_source_object_key',
	'fk_full_history_lcm_source_object_batch',
	'chk_full_history_lcm_source_object_hashes',
	'chk_full_history_lcm_source_object_range',
	'chk_full_history_lcm_source_object_sizes',
	'chk_full_history_lcm_source_object_text',
	'pk_full_history_lcm_dataset',
	'uq_full_history_lcm_dataset_storage',
	'fk_full_history_lcm_dataset_batch',
	'chk_full_history_lcm_dataset_shape',
	'chk_full_history_lcm_dataset_contract',
	'pk_full_history_lcm_watermark',
	'fk_full_history_lcm_watermark_batch',
	'chk_full_history_lcm_watermark_hash',
	'chk_full_history_lcm_watermark_position',
	'chk_full_history_lcm_watermark_initial'
] as const;

const requiredTriggers = [
	'full_history_ledger_close_meta_source.trg_reject_full_history_lcm_source_mutation',
	'full_history_ledger_close_meta_batch.trg_reject_full_history_lcm_batch_mutation',
	'full_history_ledger_close_meta_batch.trg_validate_full_history_lcm_batch_sources',
	'full_history_ledger_close_meta_batch.trg_reject_full_history_lcm_batch_overlap',
	'full_history_ledger_close_meta_batch.trg_validate_full_history_lcm_batch_datasets',
	'full_history_ledger_close_meta_source_object.trg_reject_full_history_lcm_source_object_mutation',
	'full_history_ledger_close_meta_source_object.trg_validate_full_history_lcm_source_objects',
	'full_history_ledger_close_meta_dataset.trg_reject_full_history_lcm_dataset_mutation',
	'full_history_ledger_close_meta_dataset.trg_validate_full_history_lcm_dataset_set',
	'full_history_ledger_close_meta_watermark.trg_validate_full_history_lcm_watermark_advance'
] as const;

const requiredFunctions = [
	'reject_full_history_lcm_immutable_mutation()',
	'assert_full_history_lcm_batch_source_coverage(uuid)',
	'validate_full_history_lcm_batch_source_coverage()',
	'validate_full_history_lcm_source_object_coverage()',
	'reject_full_history_lcm_batch_overlap()',
	'assert_full_history_lcm_batch_dataset_set(uuid)',
	'validate_full_history_lcm_batch_dataset_set()',
	'validate_full_history_lcm_dataset_set()',
	'validate_full_history_lcm_watermark_advance()'
] as const;

const requiredIndexes = [
	'full_history_ledger_close_meta_batch.idx_full_history_lcm_batch_frontier'
] as const;

export async function checkFullHistoryLedgerCloseMetaSchemaReadiness(
	dataSource: DataSource
): Promise<FullHistoryLedgerCloseMetaSchemaReadiness> {
	return checkPostgresSchemaReadiness(dataSource, {
		columns: requiredColumns,
		constraints: requiredConstraints,
		functions: requiredFunctions,
		indexes: requiredIndexes,
		relations: requiredRelations,
		triggers: requiredTriggers
	});
}

function relationColumns(
	relation: string,
	columns: readonly string[]
): readonly string[] {
	return columns.map((column) => `${relation}.${column}`);
}
