import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexName = 'idx_full_history_lcm_account_observation';

interface IndexStateRow {
	readonly indisready: boolean;
	readonly indisvalid: boolean;
}

export const fullHistoryAccountObservationIndexSql = `
	create index concurrently if not exists
		"idx_full_history_lcm_account_observation"
	on "full_history_lcm_account_state_change" (
		"account_id", "ledger_sequence" desc, "transaction_index" desc,
		"change_index" desc, "batch_id"
	)
`;

export class FullHistoryAccountObservationIndexMigration1785160000000 implements MigrationInterface {
	readonly name = 'FullHistoryAccountObservationIndexMigration1785160000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		const state = await readIndexState(queryRunner);
		if (state !== null && (!state.indisready || !state.indisvalid)) {
			await queryRunner.query(
				`drop index concurrently if exists "${indexName}"`
			);
		}
		await queryRunner.query(fullHistoryAccountObservationIndexSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}

async function readIndexState(
	queryRunner: QueryRunner
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
		throw new Error(
			'Account observation index state query did not return rows'
		);
	}
	const row: unknown = result[0];
	if (row === undefined) return null;
	if (!isIndexStateRow(row)) {
		throw new Error(
			'Account observation index state query returned invalid data'
		);
	}
	return row;
}

function isIndexStateRow(value: unknown): value is IndexStateRow {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const row = value as Record<string, unknown>;
	return (
		typeof row.indisready === 'boolean' && typeof row.indisvalid === 'boolean'
	);
}
