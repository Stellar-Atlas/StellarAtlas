import { MigrationInterface, type QueryRunner } from 'typeorm';

type IndexDefinition = {
	readonly createSql: string;
	readonly name: string;
};

const indexDefinitions: readonly IndexDefinition[] = [
	{
		name: 'idx_history_archive_object_root_summary',
		createSql: `
			create index concurrently if not exists
				"idx_history_archive_object_root_summary"
			on "history_archive_object_queue" (
				"archiveUrlIdentity",
				"updatedAt" desc
			)
			include (status)
			where "objectType" = 'history-archive-state'
		`
	}
];

const obsoleteProofIndexName = 'idx_history_archive_checkpoint_proof_summary';
const maximumEstimatedPeakBytes = 1024n * 1024n * 1024n;

export class HistoryArchiveStatusSummaryIndexesMigration1784800000000 implements MigrationInterface {
	name = 'HistoryArchiveStatusSummaryIndexesMigration1784800000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await assertSafeRootIndexSize(queryRunner);
		for (const definition of indexDefinitions) {
			await ensureValidConcurrentIndex(queryRunner, definition);
		}
		await dropInvalidConcurrentIndex(queryRunner, obsoleteProofIndexName);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index concurrently if exists
				"idx_history_archive_object_root_summary"
		`);
	}
}

async function assertSafeRootIndexSize(
	queryRunner: QueryRunner
): Promise<void> {
	const [row] = (await queryRunner.query(`
		select coalesce(sum(
			pg_column_size("archiveUrlIdentity")
			+ pg_column_size("updatedAt")
			+ pg_column_size(status)
			+ 48
		), 0)::text as "tupleBytes"
		from "history_archive_object_queue"
		where "objectType" = 'history-archive-state'
	`)) as readonly { readonly tupleBytes?: string }[];
	const tupleBytes = BigInt(row?.tupleBytes ?? '0');
	const estimatedFinalBytes = 16_384n + (tupleBytes * 5n) / 3n;
	const estimatedPeakBytes = estimatedFinalBytes * 3n;
	if (estimatedPeakBytes > maximumEstimatedPeakBytes) {
		throw new Error(
			'Archive status root index estimate exceeds the 1 GiB migration guard'
		);
	}
}

async function dropInvalidConcurrentIndex(
	queryRunner: QueryRunner,
	indexName: string
): Promise<void> {
	const state = await readIndexState(queryRunner, indexName);
	if (state.exists && !state.valid) {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}

async function ensureValidConcurrentIndex(
	queryRunner: QueryRunner,
	definition: IndexDefinition
): Promise<void> {
	const before = await readIndexState(queryRunner, definition.name);
	if (before.exists && !before.valid) {
		await queryRunner.query(
			`drop index concurrently if exists "${definition.name}"`
		);
	}

	await queryRunner.query(definition.createSql);
	const after = await readIndexState(queryRunner, definition.name);
	if (!after.exists || !after.valid) {
		throw new Error(`Concurrent index ${definition.name} is not valid`);
	}
}

async function readIndexState(
	queryRunner: QueryRunner,
	indexName: string
): Promise<{ readonly exists: boolean; readonly valid: boolean }> {
	const [row] = (await queryRunner.query(
		`
			select
				count(*) > 0 as "exists",
				coalesce(bool_and(index_state.indisvalid), false) as valid
			from pg_class index_relation
			join pg_namespace namespace
				on namespace.oid = index_relation.relnamespace
			left join pg_index index_state
				on index_state.indexrelid = index_relation.oid
			where namespace.nspname = current_schema()
				and index_relation.relkind = 'i'
				and index_relation.relname = $1
		`,
		[indexName]
	)) as readonly { readonly exists?: boolean; readonly valid?: boolean }[];

	return { exists: row?.exists === true, valid: row?.valid === true };
}
