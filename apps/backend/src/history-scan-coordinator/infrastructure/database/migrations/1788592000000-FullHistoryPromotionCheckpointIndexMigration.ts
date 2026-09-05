import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_checkpoint_proof_promotion_checkpoint';

interface IndexStateRow {
	readonly indisready: boolean;
	readonly indisvalid: boolean;
}

export const fullHistoryPromotionCheckpointIndexSql = `
	create index concurrently if not exists
		"idx_history_archive_checkpoint_proof_promotion_checkpoint"
	on "history_archive_checkpoint_proof" (
		"checkpointLedger",
		"evaluatedAt" desc,
		"archiveUrlIdentity"
	)
	where status = 'verified'
		and "failureKind" is null
		and "requiredObjectsComplete"
		and "proofFactsComplete"
`;

export class FullHistoryPromotionCheckpointIndexMigration1788592000000 implements MigrationInterface {
	readonly name = 'FullHistoryPromotionCheckpointIndexMigration1788592000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2min'`);
		await queryRunner.query(`set statement_timeout = 0`);
		try {
			const state = await readIndexState(queryRunner);
			if (state !== null && (!state.indisready || !state.indisvalid)) {
				await queryRunner.query(
					`drop index concurrently if exists "${indexName}"`
				);
			}
			await queryRunner.query(fullHistoryPromotionCheckpointIndexSql);
		} finally {
			await queryRunner.query(`set statement_timeout = default`);
			await queryRunner.query(`set lock_timeout = default`);
		}
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
			'Promotion checkpoint index state query did not return rows'
		);
	}
	const row: unknown = result[0];
	if (row === undefined) return null;
	if (!isIndexStateRow(row)) {
		throw new Error(
			'Promotion checkpoint index state query returned an invalid row'
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
