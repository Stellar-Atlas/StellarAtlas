import type { DataSource } from 'typeorm';

interface NameRow {
	readonly name: string;
}

export interface PostgresSchemaContract {
	readonly columns?: readonly string[];
	readonly constraints?: readonly string[];
	readonly functions?: readonly string[];
	readonly indexes?: readonly string[];
	readonly relations?: readonly string[];
	readonly triggers?: readonly string[];
}

export interface PostgresSchemaReadiness {
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

export async function checkPostgresSchemaReadiness(
	dataSource: DataSource,
	contract: PostgresSchemaContract
): Promise<PostgresSchemaReadiness> {
	const pendingMigrations = await dataSource.showMigrations();
	const missingSchemaObjects = (
		await Promise.all([
			missingRelations(dataSource, contract.relations ?? []),
			missingColumns(dataSource, contract.columns ?? []),
			missingConstraints(dataSource, contract.constraints ?? []),
			missingTriggers(dataSource, contract.triggers ?? []),
			missingFunctions(dataSource, contract.functions ?? []),
			missingIndexes(dataSource, contract.indexes ?? [])
		])
	)
		.flat()
		.toSorted();
	return Object.freeze({
		missingSchemaObjects,
		pendingMigrations,
		ready: !pendingMigrations && missingSchemaObjects.length === 0
	});
}

async function missingRelations(
	dataSource: DataSource,
	relations: readonly string[]
): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		where to_regclass(format('%I.%I', current_schema(), required.name)) is null`,
		[relations]
	);
	return rows.map((row) => `relation:${row.name}`);
}

async function missingColumns(
	dataSource: DataSource,
	columns: readonly string[]
): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join information_schema.columns actual
			on actual.table_schema = current_schema()
			and actual.table_name = split_part(required.name, '.', 1)
			and actual.column_name = split_part(required.name, '.', 2)
		where actual.column_name is null`,
		[columns]
	);
	return rows.map((row) => `column:${row.name}`);
}

async function missingConstraints(
	dataSource: DataSource,
	constraints: readonly string[]
): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		left join pg_constraint actual
			on actual.conname = required.name
			and actual.connamespace = current_schema()::regnamespace
		where actual.oid is null`,
		[constraints]
	);
	return rows.map((row) => `constraint:${row.name}`);
}

async function missingTriggers(
	dataSource: DataSource,
	triggers: readonly string[]
): Promise<string[]> {
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
		[triggers]
	);
	return rows.map((row) => `trigger:${row.name}`);
}

async function missingFunctions(
	dataSource: DataSource,
	functions: readonly string[]
): Promise<string[]> {
	const rows = await dataSource.query<NameRow[]>(
		`select required.name
		from unnest($1::text[]) as required(name)
		where to_regprocedure(current_schema() || '.' || required.name) is null`,
		[functions]
	);
	return rows.map((row) => `function:${row.name}`);
}

async function missingIndexes(
	dataSource: DataSource,
	indexes: readonly string[]
): Promise<string[]> {
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
		[indexes]
	);
	return rows.map((row) => `index:${row.name}`);
}
