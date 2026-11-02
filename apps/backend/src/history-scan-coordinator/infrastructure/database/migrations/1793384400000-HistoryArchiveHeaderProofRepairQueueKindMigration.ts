import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexName = 'IDX_history_archive_proof_refresh_header_repair_due';
const relation = 'history_archive_checkpoint_proof_refresh_queue';

type IndexMetadata = {
	readonly ready: boolean;
	readonly valid: boolean;
	readonly correctTable: boolean;
	readonly correctSchema: boolean;
	readonly qualifiedIndex: string;
	readonly keyCount: number;
	readonly columnCount: number;
	readonly definition: string;
	readonly predicate: string | null;
	readonly tablespace: string;
};

/** Additive hint on the compact refresh queue, never the archive object heap. */
export class HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000
	implements MigrationInterface
{
	readonly name =
		'HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`alter table ${relation}
			add column if not exists "refreshKind" text`);
		const [column] = (await queryRunner.query(`
			select format_type(attribute.atttypid, attribute.atttypmod) as type,
				attribute.attnotnull as "notNull",
				pg_get_expr(default_value.adbin, default_value.adrelid) as "defaultValue"
			from pg_attribute attribute
			left join pg_attrdef default_value
				on default_value.adrelid=attribute.attrelid
				and default_value.adnum=attribute.attnum
			where attribute.attrelid='${relation}'::regclass
				and attribute.attname='refreshKind' and not attribute.attisdropped
		`)) as readonly {
			readonly type: string;
			readonly notNull: boolean;
			readonly defaultValue: string | null;
		}[];
		if (column?.type !== 'text' || column.notNull || column.defaultValue !== null)
			throw new Error('Refresh kind must be nullable text without a default');

		const [location] = (await queryRunner.query(`
			select space.spcname
			from pg_class relation
			join pg_database database on database.datname=current_database()
			join pg_tablespace space on space.oid=coalesce(
				nullif(relation.reltablespace,0),database.dattablespace)
			where relation.oid='${relation}'::regclass
		`)) as readonly { readonly spcname: string }[];
		if (location === undefined)
			throw new Error('Missing proof refresh queue tablespace');
		const existing = await readIndex(queryRunner);
		if (existing !== undefined) {
			assertIndex(existing, location.spcname);
			return;
		}
		const tablespace = location.spcname.replaceAll('"', '""');
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on ${relation} using btree (
				"nextAttemptAt", "requestedAt", "archiveUrlIdentity", "checkpointLedger"
			) include ("leaseUntil")
			tablespace "${tablespace}"
			where "refreshKind" = 'header-proof-repair'
		`);
		const created = await readIndex(queryRunner);
		if (created === undefined)
			throw new Error('Missing header proof repair queue index');
		assertIndex(created, location.spcname);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		const index = await readIndex(queryRunner);
		if (index !== undefined)
			await queryRunner.query(
				`drop index concurrently if exists ${index.qualifiedIndex}`
			);
		await queryRunner.query(
			`alter table ${relation} drop column if exists "refreshKind"`
		);
	}
}

async function readIndex(
	queryRunner: QueryRunner
): Promise<IndexMetadata | undefined> {
	const [index] = (await queryRunner.query(`
		select metadata.indisready as ready, metadata.indisvalid as valid,
			metadata.indrelid='${relation}'::regclass as "correctTable",
			relation.relnamespace=parent.relnamespace as "correctSchema",
			quote_ident(namespace.nspname)||'.'||quote_ident(relation.relname) as "qualifiedIndex",
			metadata.indnkeyatts as "keyCount", metadata.indnatts as "columnCount",
			pg_get_indexdef(metadata.indexrelid) as definition,
			pg_get_expr(metadata.indpred, metadata.indrelid) as predicate,
			space.spcname as tablespace
		from pg_class parent
		join pg_namespace namespace on namespace.oid=parent.relnamespace
		join pg_index metadata on metadata.indrelid=parent.oid
		join pg_class relation on relation.oid=metadata.indexrelid
		join pg_database database on database.datname=current_database()
		join pg_tablespace space on space.oid=coalesce(
			nullif(relation.reltablespace,0),database.dattablespace)
		where parent.oid='${relation}'::regclass
			and relation.relname='${indexName}'
			and relation.relnamespace=parent.relnamespace
	`)) as readonly IndexMetadata[];
	return index;
}

function assertIndex(index: IndexMetadata, tablespace: string): void {
	const keys =
		'("nextAttemptAt", "requestedAt", "archiveUrlIdentity", "checkpointLedger")';
	if (
		!index.ready || !index.valid || !index.correctTable || !index.correctSchema ||
		index.keyCount !== 4 || index.columnCount !== 5 ||
		index.tablespace !== tablespace ||
		!index.definition.includes('USING btree') ||
		!index.definition.includes(keys) ||
		!index.definition.includes('INCLUDE ("leaseUntil")') ||
		index.predicate?.replace(/[\s()]/g, '') !==
			'"refreshKind"=\'header-proof-repair\'::text'
	)
		throw new Error('Header proof repair queue index is invalid or misplaced');
}
