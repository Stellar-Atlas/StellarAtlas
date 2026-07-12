import type { DataSource } from 'typeorm';

const requiredRelations = [
	'history_archive_checkpoint_proof',
	'history_archive_object_queue',
	'parsed_ledger_header',
	'parsed_ledger_header_observation',
	'parsed_transaction_envelope',
	'parsed_transaction_envelope_observation',
	'parsed_transaction_result',
	'parsed_transaction_result_observation',
	'full_history_ingestion_batch',
	'full_history_watermark',
	'full_history_ledger',
	'full_history_transaction',
	'full_history_transaction_result',
	'full_history_operation',
	'full_history_operation_batch_coverage',
	'full_history_operation_result',
	'full_history_operation_result_batch_coverage',
	'full_history_promotion_runtime'
] as const;

const requiredColumns = [
	['history_archive_checkpoint_proof', 'details'],
	['history_archive_checkpoint_proof', 'checkpointStateObjectRemoteId'],
	['history_archive_checkpoint_proof', 'ledgerObjectRemoteId'],
	['history_archive_checkpoint_proof', 'transactionsObjectRemoteId'],
	['history_archive_checkpoint_proof', 'resultsObjectRemoteId'],
	['history_archive_object_queue', 'verificationFacts'],
	['parsed_ledger_header_observation', 'sourceObjectRemoteId'],
	['parsed_ledger_header_observation', 'closedAt'],
	['parsed_transaction_envelope_observation', 'sourceObjectRemoteId'],
	['parsed_transaction_result_observation', 'sourceObjectRemoteId'],
	['full_history_ingestion_batch', 'checkpoint_proof_id'],
	['full_history_ingestion_batch', 'network_passphrase_hash']
] as const;

const requiredTriggers = [
	[
		'full_history_ingestion_batch',
		'trg_validate_full_history_batch_provenance'
	],
	['full_history_ingestion_batch', 'trg_reject_full_history_batch_mutation'],
	['full_history_watermark', 'trg_validate_full_history_watermark_advance']
] as const;

export interface FullHistoryPromotionSchemaReadiness {
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

interface NameRow {
	readonly name: string;
}

export async function checkFullHistoryPromotionSchemaReadiness(
	dataSource: DataSource
): Promise<FullHistoryPromotionSchemaReadiness> {
	const pendingMigrations = await dataSource.showMigrations();
	const missingSchemaObjects = [
		...(await missingRelations(dataSource)),
		...(await missingColumns(dataSource)),
		...(await missingTriggers(dataSource)),
		...(await missingFunctions(dataSource))
	].toSorted();
	return {
		missingSchemaObjects,
		pendingMigrations,
		ready: !pendingMigrations && missingSchemaObjects.length === 0
	};
}

async function missingRelations(dataSource: DataSource): Promise<string[]> {
	const rows = (await dataSource.query(
		`select relation as name
		from unnest($1::text[]) as required(relation)
		where to_regclass(format('%I.%I', current_schema(), relation)) is null`,
		[requiredRelations]
	)) as NameRow[];
	return rows.map((row) => `relation:${row.name}`);
}

async function missingColumns(dataSource: DataSource): Promise<string[]> {
	const values = requiredColumns
		.map(
			([table, column], index) =>
				`($${index * 2 + 1}::text, $${index * 2 + 2}::text)`
		)
		.join(', ');
	const rows = (await dataSource.query(
		`with required(table_name, column_name) as (values ${values})
		select required.table_name || '.' || required.column_name as name
		from required
		left join information_schema.columns actual
			on actual.table_schema = current_schema()
			and actual.table_name = required.table_name
			and actual.column_name = required.column_name
		where actual.column_name is null`,
		requiredColumns.flat()
	)) as NameRow[];
	return rows.map((row) => `column:${row.name}`);
}

async function missingTriggers(dataSource: DataSource): Promise<string[]> {
	const values = requiredTriggers
		.map(
			([table, trigger], index) =>
				`($${index * 2 + 1}::text, $${index * 2 + 2}::text)`
		)
		.join(', ');
	const rows = (await dataSource.query(
		`with required(table_name, trigger_name) as (values ${values})
		select required.table_name || '.' || required.trigger_name as name
		from required
		left join pg_class relation
			on relation.relname = required.table_name
			and relation.relnamespace = current_schema()::regnamespace
		left join pg_trigger trigger
			on trigger.tgrelid = relation.oid
			and trigger.tgname = required.trigger_name
			and not trigger.tgisinternal
		where trigger.oid is null`,
		requiredTriggers.flat()
	)) as NameRow[];
	return rows.map((row) => `trigger:${row.name}`);
}

async function missingFunctions(dataSource: DataSource): Promise<string[]> {
	const functions = [
		'full_history_verified_source_matches(uuid,text,text,bigint,bytea,text)',
		'validate_full_history_batch_provenance()',
		'reject_full_history_batch_mutation()',
		'validate_full_history_watermark_advance()'
	] as const;
	const rows = (await dataSource.query(
		`select function_name as name
		from unnest($1::text[]) as required(function_name)
		where to_regprocedure(current_schema() || '.' || function_name) is null`,
		[functions]
	)) as NameRow[];
	return rows.map((row) => `function:${row.name}`);
}
