import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ParsedHistoryObservationMigration1784850000000 implements MigrationInterface {
	name = 'ParsedHistoryObservationMigration1784850000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(createLedgerObservationTableSql);
		await queryRunner.query(createEnvelopeObservationTableSql);
		await queryRunner.query(createResultObservationTableSql);
		await queryRunner.query(repairLedgerObservationTableSql);
		await queryRunner.query(repairEnvelopeObservationTableSql);
		await queryRunner.query(repairResultObservationTableSql);
		await queryRunner.query(createLedgerObjectIndexSql);
		await queryRunner.query(createEnvelopeObjectIndexSql);
		await queryRunner.query(createResultObjectIndexSql);
		await queryRunner.query(validateObservationSchemaSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(
			'drop table if exists "parsed_transaction_result_observation"'
		);
		await queryRunner.query(
			'drop table if exists "parsed_transaction_envelope_observation"'
		);
		await queryRunner.query(
			'drop table if exists "parsed_ledger_header_observation"'
		);
	}
}

// Legacy range scans and object scans share this registration contract. The
// opaque source id stays text; canonical promotion only joins UUIDs named by a
// verified object proof.

const createLedgerObservationTableSql = `
	create table if not exists "parsed_ledger_header_observation" (
		"id" bigserial not null,
		"parsedLedgerHeaderId" integer not null,
		"sourceObjectRemoteId" text not null,
		"observedAt" timestamptz not null,
		"closedAt" timestamptz,
		constraint "PK_parsed_ledger_header_observation" primary key ("id"),
		constraint "UQ_parsed_ledger_header_observation_source"
			unique ("parsedLedgerHeaderId", "sourceObjectRemoteId"),
		constraint "FK_parsed_ledger_header_observation_row"
			foreign key ("parsedLedgerHeaderId")
			references "parsed_ledger_header" ("id") on delete cascade
	)
`;

const createEnvelopeObservationTableSql = `
	create table if not exists "parsed_transaction_envelope_observation" (
		"id" bigserial not null,
		"parsedTransactionEnvelopeId" integer not null,
		"sourceObjectRemoteId" text not null,
		"observedAt" timestamptz not null,
		constraint "PK_parsed_transaction_envelope_observation" primary key ("id"),
		constraint "UQ_parsed_transaction_envelope_observation_source"
			unique ("parsedTransactionEnvelopeId", "sourceObjectRemoteId"),
		constraint "FK_parsed_transaction_envelope_observation_row"
			foreign key ("parsedTransactionEnvelopeId")
			references "parsed_transaction_envelope" ("id") on delete cascade
	)
`;

const createResultObservationTableSql = `
	create table if not exists "parsed_transaction_result_observation" (
		"id" bigserial not null,
		"parsedTransactionResultId" integer not null,
		"sourceObjectRemoteId" text not null,
		"observedAt" timestamptz not null,
		constraint "PK_parsed_transaction_result_observation" primary key ("id"),
		constraint "UQ_parsed_transaction_result_observation_source"
			unique ("parsedTransactionResultId", "sourceObjectRemoteId"),
		constraint "FK_parsed_transaction_result_observation_row"
			foreign key ("parsedTransactionResultId")
			references "parsed_transaction_result" ("id") on delete cascade
	)
`;

const repairLedgerObservationTableSql = `
	alter table "parsed_ledger_header_observation"
		add column if not exists "id" bigserial,
		add column if not exists "parsedLedgerHeaderId" integer,
		add column if not exists "sourceObjectRemoteId" text,
		add column if not exists "observedAt" timestamptz,
		add column if not exists "closedAt" timestamptz;
	alter table "parsed_ledger_header_observation"
		alter column "id" set not null,
		alter column "parsedLedgerHeaderId" set not null,
		alter column "sourceObjectRemoteId" set not null,
		alter column "observedAt" set not null;
	do $repair$
	begin
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_ledger_header_observation'::regclass
				and conname = 'PK_parsed_ledger_header_observation'
				and contype = 'p'
		) then
			alter table "parsed_ledger_header_observation"
				add constraint "PK_parsed_ledger_header_observation"
				primary key ("id");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_ledger_header_observation'::regclass
				and conname = 'UQ_parsed_ledger_header_observation_source'
				and contype = 'u'
		) then
			alter table "parsed_ledger_header_observation"
				add constraint "UQ_parsed_ledger_header_observation_source"
				unique ("parsedLedgerHeaderId", "sourceObjectRemoteId");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_ledger_header_observation'::regclass
				and conname = 'FK_parsed_ledger_header_observation_row'
				and contype = 'f'
		) then
			alter table "parsed_ledger_header_observation"
				add constraint "FK_parsed_ledger_header_observation_row"
				foreign key ("parsedLedgerHeaderId")
				references "parsed_ledger_header" ("id") on delete cascade;
		end if;
	end
	$repair$
`;

const repairEnvelopeObservationTableSql = `
	alter table "parsed_transaction_envelope_observation"
		add column if not exists "id" bigserial,
		add column if not exists "parsedTransactionEnvelopeId" integer,
		add column if not exists "sourceObjectRemoteId" text,
		add column if not exists "observedAt" timestamptz;
	alter table "parsed_transaction_envelope_observation"
		alter column "id" set not null,
		alter column "parsedTransactionEnvelopeId" set not null,
		alter column "sourceObjectRemoteId" set not null,
		alter column "observedAt" set not null;
	do $repair$
	begin
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_envelope_observation'::regclass
				and conname = 'PK_parsed_transaction_envelope_observation'
				and contype = 'p'
		) then
			alter table "parsed_transaction_envelope_observation"
				add constraint "PK_parsed_transaction_envelope_observation"
				primary key ("id");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_envelope_observation'::regclass
				and conname = 'UQ_parsed_transaction_envelope_observation_source'
				and contype = 'u'
		) then
			alter table "parsed_transaction_envelope_observation"
				add constraint "UQ_parsed_transaction_envelope_observation_source"
				unique ("parsedTransactionEnvelopeId", "sourceObjectRemoteId");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_envelope_observation'::regclass
				and conname = 'FK_parsed_transaction_envelope_observation_row'
				and contype = 'f'
		) then
			alter table "parsed_transaction_envelope_observation"
				add constraint "FK_parsed_transaction_envelope_observation_row"
				foreign key ("parsedTransactionEnvelopeId")
				references "parsed_transaction_envelope" ("id") on delete cascade;
		end if;
	end
	$repair$
`;

const repairResultObservationTableSql = `
	alter table "parsed_transaction_result_observation"
		add column if not exists "id" bigserial,
		add column if not exists "parsedTransactionResultId" integer,
		add column if not exists "sourceObjectRemoteId" text,
		add column if not exists "observedAt" timestamptz;
	alter table "parsed_transaction_result_observation"
		alter column "id" set not null,
		alter column "parsedTransactionResultId" set not null,
		alter column "sourceObjectRemoteId" set not null,
		alter column "observedAt" set not null;
	do $repair$
	begin
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_result_observation'::regclass
				and conname = 'PK_parsed_transaction_result_observation'
				and contype = 'p'
		) then
			alter table "parsed_transaction_result_observation"
				add constraint "PK_parsed_transaction_result_observation"
				primary key ("id");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_result_observation'::regclass
				and conname = 'UQ_parsed_transaction_result_observation_source'
				and contype = 'u'
		) then
			alter table "parsed_transaction_result_observation"
				add constraint "UQ_parsed_transaction_result_observation_source"
				unique ("parsedTransactionResultId", "sourceObjectRemoteId");
		end if;
		if not exists (
			select 1 from pg_constraint
			where conrelid = 'parsed_transaction_result_observation'::regclass
				and conname = 'FK_parsed_transaction_result_observation_row'
				and contype = 'f'
		) then
			alter table "parsed_transaction_result_observation"
				add constraint "FK_parsed_transaction_result_observation_row"
				foreign key ("parsedTransactionResultId")
				references "parsed_transaction_result" ("id") on delete cascade;
		end if;
	end
	$repair$
`;

const createLedgerObjectIndexSql = `
	create index if not exists "IDX_parsed_ledger_header_observation_object"
	on "parsed_ledger_header_observation" ("sourceObjectRemoteId")
`;

const createEnvelopeObjectIndexSql = `
	create index if not exists "IDX_parsed_transaction_envelope_observation_object"
	on "parsed_transaction_envelope_observation" ("sourceObjectRemoteId")
`;

const createResultObjectIndexSql = `
	create index if not exists "IDX_parsed_transaction_result_observation_object"
	on "parsed_transaction_result_observation" ("sourceObjectRemoteId")
`;

const validateObservationSchemaSql = `
	do $validate$
	begin
		if exists (
			with expected(table_name, column_name, data_type, is_nullable) as (
				values
					('parsed_ledger_header_observation', 'id', 'bigint', 'NO'),
					('parsed_ledger_header_observation', 'parsedLedgerHeaderId', 'integer', 'NO'),
					('parsed_ledger_header_observation', 'sourceObjectRemoteId', 'text', 'NO'),
					('parsed_ledger_header_observation', 'observedAt', 'timestamp with time zone', 'NO'),
					('parsed_ledger_header_observation', 'closedAt', 'timestamp with time zone', 'YES'),
					('parsed_transaction_envelope_observation', 'id', 'bigint', 'NO'),
					('parsed_transaction_envelope_observation', 'parsedTransactionEnvelopeId', 'integer', 'NO'),
					('parsed_transaction_envelope_observation', 'sourceObjectRemoteId', 'text', 'NO'),
					('parsed_transaction_envelope_observation', 'observedAt', 'timestamp with time zone', 'NO'),
					('parsed_transaction_result_observation', 'id', 'bigint', 'NO'),
					('parsed_transaction_result_observation', 'parsedTransactionResultId', 'integer', 'NO'),
					('parsed_transaction_result_observation', 'sourceObjectRemoteId', 'text', 'NO'),
					('parsed_transaction_result_observation', 'observedAt', 'timestamp with time zone', 'NO')
			)
			select 1
			from expected
			left join information_schema.columns actual
				on actual.table_schema = current_schema()
				and actual.table_name = expected.table_name
				and actual.column_name = expected.column_name
			where actual.column_name is null
				or actual.data_type <> expected.data_type
				or actual.is_nullable <> expected.is_nullable
				or (expected.column_name = 'id' and actual.column_default is null)
		) then
			raise exception 'parsed-history observation schema is incompatible';
		end if;

		if (
			with expected(table_name) as (
				values
					('parsed_ledger_header_observation'),
					('parsed_transaction_envelope_observation'),
					('parsed_transaction_result_observation')
			)
			select count(*)
			from expected
			where pg_get_serial_sequence(
				format('%I.%I', current_schema(), table_name),
				'id'
			) is null
				or not exists (
					select 1
					from pg_class relation
					join pg_attribute attribute
						on attribute.attrelid = relation.oid
						and attribute.attname = 'id'
						and not attribute.attisdropped
					join pg_attrdef definition
						on definition.adrelid = relation.oid
						and definition.adnum = attribute.attnum
					join pg_depend dependency
						on dependency.classid = 'pg_attrdef'::regclass
						and dependency.objid = definition.oid
						and dependency.refclassid = 'pg_class'::regclass
					where relation.oid = to_regclass(
						format('%I.%I', current_schema(), table_name)
					)
						and dependency.refobjid = to_regclass(
							pg_get_serial_sequence(
								format('%I.%I', current_schema(), table_name),
								'id'
							)
						)
				)
		) > 0 then
			raise exception 'parsed-history observation id defaults are incompatible';
		end if;

		if exists (
			with expected(
				table_name,
				constraint_name,
				constraint_type,
				column_names,
				referenced_table,
				referenced_columns,
				delete_action
			) as (
				values
					('parsed_ledger_header_observation', 'PK_parsed_ledger_header_observation', 'p', array['id']::text[], null::text, null::text[], null::text),
					('parsed_ledger_header_observation', 'UQ_parsed_ledger_header_observation_source', 'u', array['parsedLedgerHeaderId', 'sourceObjectRemoteId']::text[], null::text, null::text[], null::text),
					('parsed_ledger_header_observation', 'FK_parsed_ledger_header_observation_row', 'f', array['parsedLedgerHeaderId']::text[], 'parsed_ledger_header', array['id']::text[], 'c'),
					('parsed_transaction_envelope_observation', 'PK_parsed_transaction_envelope_observation', 'p', array['id']::text[], null::text, null::text[], null::text),
					('parsed_transaction_envelope_observation', 'UQ_parsed_transaction_envelope_observation_source', 'u', array['parsedTransactionEnvelopeId', 'sourceObjectRemoteId']::text[], null::text, null::text[], null::text),
					('parsed_transaction_envelope_observation', 'FK_parsed_transaction_envelope_observation_row', 'f', array['parsedTransactionEnvelopeId']::text[], 'parsed_transaction_envelope', array['id']::text[], 'c'),
					('parsed_transaction_result_observation', 'PK_parsed_transaction_result_observation', 'p', array['id']::text[], null::text, null::text[], null::text),
					('parsed_transaction_result_observation', 'UQ_parsed_transaction_result_observation_source', 'u', array['parsedTransactionResultId', 'sourceObjectRemoteId']::text[], null::text, null::text[], null::text),
					('parsed_transaction_result_observation', 'FK_parsed_transaction_result_observation_row', 'f', array['parsedTransactionResultId']::text[], 'parsed_transaction_result', array['id']::text[], 'c')
			), actual as (
				select
					expected.*,
					constraint_record.oid as constraint_oid,
					constraint_record.contype::text as actual_type,
					constraint_record.conkey as actual_columns,
					constraint_record.confrelid as actual_referenced_table,
					constraint_record.confkey as actual_referenced_columns,
					constraint_record.confdeltype::text as actual_delete_action,
					constraint_record.condeferrable as actual_deferrable,
					constraint_record.condeferred as actual_initially_deferred,
					relation.oid as expected_table,
					case
						when expected.referenced_table is null then null
						else to_regclass(format('%I.%I', current_schema(), expected.referenced_table))
					end as expected_referenced_table,
					(
						select array_agg(attribute.attnum order by requested.position)::smallint[]
						from unnest(expected.column_names) with ordinality requested(column_name, position)
						join pg_attribute attribute
							on attribute.attrelid = relation.oid
							and attribute.attname = requested.column_name
							and not attribute.attisdropped
					) as expected_columns,
					case
						when expected.referenced_table is null then null
						else (
							select array_agg(attribute.attnum order by requested.position)::smallint[]
							from unnest(expected.referenced_columns) with ordinality requested(column_name, position)
							join pg_attribute attribute
								on attribute.attrelid = to_regclass(
									format('%I.%I', current_schema(), expected.referenced_table)
								)
								and attribute.attname = requested.column_name
								and not attribute.attisdropped
						)
					end as expected_referenced_columns
				from expected
				left join pg_class relation
					on relation.oid = to_regclass(
					format('%I.%I', current_schema(), expected.table_name)
				)
				left join pg_constraint constraint_record
					on constraint_record.conrelid = relation.oid
					and constraint_record.conname = expected.constraint_name
			)
			select 1
			from actual
			where constraint_oid is null
				or actual_type is distinct from constraint_type
				or actual_columns is distinct from expected_columns
				or actual_deferrable
				or actual_initially_deferred
				or (
					constraint_type = 'f'
					and (
						actual_referenced_table is distinct from expected_referenced_table
						or actual_referenced_columns is distinct from expected_referenced_columns
						or actual_delete_action is distinct from delete_action
					)
				)
		) then
			raise exception 'parsed-history observation constraints are incompatible';
		end if;

		if exists (
			with expected(table_name, index_name, column_name) as (
				values
					('parsed_ledger_header_observation', 'IDX_parsed_ledger_header_observation_object', 'sourceObjectRemoteId'),
					('parsed_transaction_envelope_observation', 'IDX_parsed_transaction_envelope_observation_object', 'sourceObjectRemoteId'),
					('parsed_transaction_result_observation', 'IDX_parsed_transaction_result_observation_object', 'sourceObjectRemoteId')
			)
			select 1
			from expected
			left join pg_class relation
				on relation.oid = to_regclass(
					format('%I.%I', current_schema(), expected.table_name)
				)
			left join pg_class index_relation
				on index_relation.oid = to_regclass(
					format('%I.%I', current_schema(), expected.index_name)
				)
			left join pg_index index_definition
				on index_definition.indrelid = relation.oid
				and index_definition.indexrelid = index_relation.oid
			left join pg_am access_method
				on access_method.oid = index_relation.relam
			where index_definition.indexrelid is null
				or not index_definition.indisvalid
				or not index_definition.indisready
				or index_definition.indisunique
				or index_definition.indnkeyatts <> 1
				or index_definition.indnatts <> 1
				or index_definition.indpred is not null
				or index_definition.indexprs is not null
				or access_method.amname is distinct from 'btree'
				or (
					select array_agg(index_key.attnum order by index_key.position)::smallint[]
					from unnest(index_definition.indkey::smallint[])
						with ordinality index_key(attnum, position)
				) is distinct from array[
					(
						select attribute.attnum
						from pg_attribute attribute
						where attribute.attrelid = relation.oid
							and attribute.attname = expected.column_name
							and not attribute.attisdropped
					)
				]::smallint[]
		) then
			raise exception 'parsed-history observation indexes are incompatible';
		end if;
	end
	$validate$
`;
