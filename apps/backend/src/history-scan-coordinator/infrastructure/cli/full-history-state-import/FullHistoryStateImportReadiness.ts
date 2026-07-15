import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import type { DataSource } from 'typeorm';

const requiredRelations = [
	'history_archive_checkpoint_proof',
	'history_archive_object_queue',
	'full_history_ledger_close_meta_batch',
	'full_history_ledger_close_meta_dataset',
	'full_history_lcm_state_import',
	'full_history_lcm_account_state_change',
	'full_history_lcm_trustline_state_change',
	'full_history_lcm_state_canonical_coverage',
	'full_history_lcm_ledger_projection',
	'full_history_lcm_state_canonical_batch_link',
	'full_history_ingestion_batch',
	'full_history_ledger'
] as const;

const requiredColumns = [
	...relationColumns('full_history_ledger_close_meta_batch', [
		'id',
		'start_ledger',
		'end_ledger'
	]),
	...relationColumns('full_history_ledger_close_meta_dataset', [
		'batch_id',
		'dataset',
		'storage_key',
		'output_sha256',
		'record_count'
	]),
	...relationColumns('full_history_lcm_state_import', [
		'batch_id',
		'dataset',
		'source_path',
		'source_sha256',
		'expected_record_count',
		'imported_record_count',
		'imported_row_set_sha256',
		'status',
		'lease_owner',
		'lease_expires_at',
		'attempt_count',
		'created_at',
		'updated_at',
		'next_attempt_at',
		'completed_at',
		'error_text'
	]),
	...relationColumns('full_history_lcm_account_state_change', [
		'batch_id',
		'row_sha256',
		'ledger_sequence',
		'transaction_index',
		'change_index',
		'transaction_hash',
		'reason',
		'operation_index',
		'upgrade_index',
		'change_type',
		'change_type_string',
		'deleted',
		'ledger_key_sha256',
		'state_entry_xdr',
		'last_modified_ledger',
		'sponsor',
		'closed_at_unix_millis',
		'account_id',
		'balance',
		'buying_liabilities',
		'selling_liabilities',
		'sequence_number',
		'sequence_ledger',
		'sequence_time',
		'subentry_count',
		'flags',
		'home_domain',
		'inflation_destination',
		'master_weight',
		'low_threshold',
		'medium_threshold',
		'high_threshold',
		'sponsored_entry_count',
		'sponsoring_entry_count',
		'signer_count',
		'signer_keys',
		'signer_weights',
		'signer_sponsors'
	]),
	...relationColumns('full_history_lcm_trustline_state_change', [
		'batch_id',
		'row_sha256',
		'ledger_sequence',
		'transaction_index',
		'change_index',
		'transaction_hash',
		'reason',
		'operation_index',
		'upgrade_index',
		'change_type',
		'change_type_string',
		'deleted',
		'ledger_key_sha256',
		'state_entry_xdr',
		'last_modified_ledger',
		'sponsor',
		'closed_at_unix_millis',
		'account_id',
		'asset_type',
		'asset_type_string',
		'asset_code',
		'asset_issuer',
		'liquidity_pool_id',
		'balance',
		'limit',
		'buying_liabilities',
		'selling_liabilities',
		'liquidity_pool_use_count',
		'flags'
	]),
	...relationColumns('full_history_lcm_state_canonical_coverage', [
		'batch_id',
		'network_passphrase_hash',
		'ledger_source_path',
		'ledger_source_sha256',
		'expected_ledger_count',
		'matched_ledger_count',
		'status',
		'lease_owner',
		'lease_expires_at',
		'attempt_count',
		'next_attempt_at',
		'completed_at',
		'minimum_proof_version',
		'latest_proof_evaluated_at',
		'failure_kind',
		'error_text'
	]),
	...relationColumns('full_history_lcm_ledger_projection', [
		'batch_id',
		'ledger_sequence',
		'ledger_hash',
		'previous_ledger_hash',
		'transaction_set_hash',
		'transaction_result_hash',
		'bucket_list_hash',
		'protocol_version',
		'closed_at',
		'transaction_count'
	]),
	...relationColumns('full_history_lcm_state_canonical_batch_link', [
		'lcm_batch_id',
		'canonical_batch_id',
		'network_passphrase_hash'
	])
] as const;

const requiredConstraints = [
	'pk_full_history_lcm_state_import',
	'fk_full_history_lcm_state_import_batch',
	'chk_full_history_lcm_state_import_dataset',
	'chk_full_history_lcm_state_import_source',
	'chk_full_history_lcm_state_import_counts',
	'chk_full_history_lcm_state_import_status',
	'chk_full_history_lcm_state_import_timestamps',
	'chk_full_history_lcm_state_import_lifecycle',
	'chk_full_history_lcm_state_import_row_set',
	'pk_full_history_lcm_account_state_change',
	'fk_full_history_lcm_account_state_change_batch',
	'chk_full_history_lcm_account_change_identity',
	'chk_full_history_lcm_account_change_provenance',
	'chk_full_history_lcm_account_change_hashes',
	'chk_full_history_lcm_account_change_text',
	'chk_full_history_lcm_account_change_numbers',
	'chk_full_history_lcm_account_change_sequence',
	'chk_full_history_lcm_account_change_signers',
	'chk_full_history_lcm_account_change_row_sha256',
	'pk_full_history_lcm_trustline_state_change',
	'fk_full_history_lcm_trustline_state_change_batch',
	'chk_full_history_lcm_trustline_change_identity',
	'chk_full_history_lcm_trustline_change_provenance',
	'chk_full_history_lcm_trustline_change_hashes',
	'chk_full_history_lcm_trustline_change_text',
	'chk_full_history_lcm_trustline_change_asset',
	'chk_full_history_lcm_trustline_change_numbers',
	'chk_full_history_lcm_trustline_change_row_sha256',
	'pk_full_history_lcm_state_canonical_coverage',
	'uq_full_history_lcm_state_coverage_identity',
	'fk_full_history_lcm_state_coverage_batch',
	'chk_full_history_lcm_state_coverage_source',
	'chk_full_history_lcm_state_coverage_counts',
	'chk_full_history_lcm_state_coverage_status',
	'chk_full_history_lcm_state_coverage_lifecycle',
	'chk_full_history_lcm_state_coverage_timestamps',
	'pk_full_history_lcm_ledger_projection',
	'fk_full_history_lcm_ledger_projection_batch',
	'chk_full_history_lcm_ledger_projection_hashes',
	'chk_full_history_lcm_ledger_projection_values',
	'pk_full_history_lcm_state_canonical_batch_link',
	'fk_full_history_lcm_state_link_coverage',
	'fk_full_history_lcm_state_link_canonical',
	'chk_full_history_lcm_state_link_hash'
] as const;

const requiredTriggers = [
	'full_history_ingestion_batch.trg_validate_full_history_batch_provenance',
	'full_history_lcm_state_import.trg_reject_full_history_lcm_completed_import_mutation',
	'full_history_lcm_account_state_change.trg_validate_full_history_lcm_account_change_range',
	'full_history_lcm_account_state_change.trg_validate_full_history_lcm_account_change_import',
	'full_history_lcm_account_state_change.trg_reject_full_history_lcm_account_change_mutation',
	'full_history_lcm_trustline_state_change.trg_validate_full_history_lcm_trustline_change_range',
	'full_history_lcm_trustline_state_change.trg_validate_full_history_lcm_trustline_change_import',
	'full_history_lcm_trustline_state_change.trg_reject_full_history_lcm_trustline_change_mutation',
	'full_history_lcm_state_canonical_coverage.trg_validate_full_history_lcm_coverage_identity',
	'full_history_lcm_state_canonical_coverage.trg_guard_full_history_lcm_canonical_coverage',
	'full_history_lcm_ledger_projection.trg_validate_full_history_lcm_ledger_projection_range',
	'full_history_lcm_ledger_projection.trg_validate_full_history_lcm_ledger_projection_insert',
	'full_history_lcm_ledger_projection.trg_reject_full_history_lcm_ledger_projection_mutation',
	'full_history_lcm_state_canonical_batch_link.trg_reject_full_history_lcm_state_link_mutation',
	'full_history_lcm_state_canonical_batch_link.trg_validate_full_history_lcm_state_link_insert',
	'full_history_ledger.trg_validate_full_history_canonical_ledger_batch_range',
	'full_history_ledger.trg_reject_full_history_canonical_ledger_mutation'
] as const;

const requiredFunctions = [
	'validate_full_history_batch_provenance()',
	'validate_full_history_lcm_state_change_batch_range()',
	'validate_full_history_lcm_state_evidence_insert()',
	'reject_full_history_lcm_completed_import_mutation()',
	'reject_full_history_lcm_state_evidence_mutation()',
	'validate_full_history_lcm_coverage_identity()',
	'validate_full_history_lcm_ledger_projection_range()',
	'validate_full_history_lcm_canonical_evidence_insert()',
	'guard_full_history_lcm_canonical_coverage()',
	'reject_full_history_lcm_canonical_evidence_mutation()',
	'validate_full_history_canonical_ledger_batch_range()',
	'reject_full_history_canonical_ledger_mutation()'
] as const;

const requiredIndexes = [
	'full_history_lcm_state_import.idx_full_history_lcm_state_import_claim',
	'full_history_lcm_state_canonical_coverage.idx_full_history_lcm_state_coverage_claim'
] as const;

interface NameRow {
	readonly name: string;
}

export interface FullHistoryStateImportReadiness {
	readonly missingRuntimeObjects: readonly string[];
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

export interface FullHistoryStateImportRuntimePaths {
	readonly executablePath: string;
	readonly storageRoot: string;
}

export async function checkFullHistoryStateImportReadiness(
	dataSource: DataSource,
	paths: FullHistoryStateImportRuntimePaths
): Promise<FullHistoryStateImportReadiness> {
	const runtimePromise = missingRuntimeObjects(paths);
	const pendingMigrations = await dataSource.showMigrations();
	const missingSchemaObjects = (
		await Promise.all([
			missingRelations(dataSource),
			missingColumns(dataSource),
			missingConstraints(dataSource),
			missingTriggers(dataSource),
			missingFunctions(dataSource),
			missingIndexes(dataSource)
		])
	)
		.flat()
		.toSorted();
	const missingRuntime = (await runtimePromise).toSorted();
	return Object.freeze({
		missingRuntimeObjects: missingRuntime,
		missingSchemaObjects,
		pendingMigrations,
		ready:
			!pendingMigrations &&
			missingSchemaObjects.length === 0 &&
			missingRuntime.length === 0
	});
}

async function missingRelations(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		where to_regclass(format('%I.%I', current_schema(), required.name)) is null`,
		[requiredRelations]
	);
	return rows.map((row) => `relation:${row.name}`);
}

async function missingColumns(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join information_schema.columns actual
			on actual.table_schema = current_schema()
			and actual.table_name = split_part(required.name, '.', 1)
			and actual.column_name = split_part(required.name, '.', 2)
		where actual.column_name is null`,
		[requiredColumns]
	);
	return rows.map((row) => `column:${row.name}`);
}

async function missingConstraints(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join pg_constraint actual
			on actual.conname = required.name
			and actual.connamespace = current_schema()::regnamespace
		where actual.oid is null`,
		[requiredConstraints]
	);
	return rows.map((row) => `constraint:${row.name}`);
}

async function missingTriggers(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join pg_class relation
			on relation.relname = split_part(required.name, '.', 1)
			and relation.relnamespace = current_schema()::regnamespace
		left join pg_trigger actual
			on actual.tgrelid = relation.oid
			and actual.tgname = split_part(required.name, '.', 2)
			and not actual.tgisinternal
		where actual.oid is null`,
		[requiredTriggers]
	);
	return rows.map((row) => `trigger:${row.name}`);
}

async function missingFunctions(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		where to_regprocedure(current_schema() || '.' || required.name) is null`,
		[requiredFunctions]
	);
	return rows.map((row) => `function:${row.name}`);
}

async function missingIndexes(dataSource: DataSource): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join pg_class relation
			on relation.relname = split_part(required.name, '.', 1)
			and relation.relnamespace = current_schema()::regnamespace
		left join pg_class actual
			on actual.relname = split_part(required.name, '.', 2)
			and actual.relnamespace = current_schema()::regnamespace
		left join pg_index binding
			on binding.indrelid = relation.oid
			and binding.indexrelid = actual.oid
		where binding.indexrelid is null`,
		[requiredIndexes]
	);
	return rows.map((row) => `index:${row.name}`);
}

async function missingRuntimeObjects(
	paths: FullHistoryStateImportRuntimePaths
): Promise<string[]> {
	const [executableIssue, storageIssue] = await Promise.all([
		checkExecutable(paths.executablePath),
		checkStorageRoot(paths.storageRoot)
	]);
	return [executableIssue, storageIssue].filter(
		(issue): issue is string => issue !== null
	);
}

async function checkExecutable(path: string): Promise<string | null> {
	try {
		const resolved = await realpath(path);
		const info = await stat(resolved);
		if (!info.isFile()) return 'executable:not-regular-file';
		await access(resolved, constants.X_OK);
		return null;
	} catch {
		return 'executable:missing-or-inaccessible';
	}
}

async function checkStorageRoot(path: string): Promise<string | null> {
	try {
		const resolved = await realpath(path);
		const info = await stat(resolved);
		if (!info.isDirectory()) return 'storage-root:not-directory';
		await access(resolved, constants.R_OK | constants.X_OK);
		return null;
	} catch {
		return 'storage-root:missing-or-inaccessible';
	}
}

function relationColumns(
	relation: string,
	columns: readonly string[]
): readonly string[] {
	return columns.map((column) => `${relation}.${column}`);
}
