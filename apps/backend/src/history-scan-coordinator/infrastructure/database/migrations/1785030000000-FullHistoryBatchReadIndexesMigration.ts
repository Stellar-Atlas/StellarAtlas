import type { MigrationInterface, QueryRunner } from 'typeorm';

const transactionResultIndexName =
	'idx_full_history_transaction_result_batch_order';
const operationIndexName = 'idx_full_history_operation_batch_order';

interface IndexStateRow {
	readonly indisready: boolean;
	readonly indisvalid: boolean;
}

export const fullHistoryTransactionResultBatchOrderIndexSql = `
	create index concurrently if not exists
		"idx_full_history_transaction_result_batch_order"
	on "full_history_transaction_result" (
		"batch_id", "ledger_sequence", "transaction_index", "transaction_hash"
	)
`;

export const fullHistoryOperationBatchOrderIndexSql = `
	create index concurrently if not exists
		"idx_full_history_operation_batch_order"
	on "full_history_operation" (
		"batch_id", "ledger_sequence", "transaction_index", "operation_index"
	)
`;

export class FullHistoryBatchReadIndexesMigration1785030000000 implements MigrationInterface {
	readonly name = 'FullHistoryBatchReadIndexesMigration1785030000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await ensureConcurrentIndex(
			queryRunner,
			transactionResultIndexName,
			fullHistoryTransactionResultBatchOrderIndexSql
		);
		await ensureConcurrentIndex(
			queryRunner,
			operationIndexName,
			fullHistoryOperationBatchOrderIndexSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop index if exists "idx_full_history_operation_batch_order"'
		);
		await queryRunner.query(
			'drop index if exists "idx_full_history_transaction_result_batch_order"'
		);
	}
}

async function ensureConcurrentIndex(
	queryRunner: QueryRunner,
	indexName: string,
	createSql: string
): Promise<void> {
	const state = await readIndexState(queryRunner, indexName);
	if (state !== null && (!state.indisready || !state.indisvalid)) {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
	await queryRunner.query(createSql);
}

async function readIndexState(
	queryRunner: QueryRunner,
	indexName: string
): Promise<IndexStateRow | null> {
	const result: unknown = await queryRunner.query(
		`
			select index_state.indisready, index_state.indisvalid
			from pg_index index_state
			join pg_class index_class
				on index_class.oid = index_state.indexrelid
			join pg_namespace index_namespace
				on index_namespace.oid = index_class.relnamespace
			where index_namespace.nspname = current_schema()
				and index_class.relname = $1
		`,
		[indexName]
	);
	if (!Array.isArray(result)) {
		throw new Error('Full-history index state query did not return rows');
	}
	const row: unknown = result[0];
	if (row === undefined) return null;
	if (!isIndexStateRow(row)) {
		throw new Error('Full-history index state query returned an invalid row');
	}
	return row;
}

function isIndexStateRow(value: unknown): value is IndexStateRow {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const row = value as Record<string, unknown>;
	return (
		typeof row.indisready === 'boolean' &&
		typeof row.indisvalid === 'boolean'
	);
}
