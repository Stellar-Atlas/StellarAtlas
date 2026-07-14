import {
	createFullHistoryLedgerCloseMetaDatasetContractSql,
	dropFullHistoryLedgerCloseMetaDatasetContractSql
} from './FullHistoryLedgerCloseMetaDatasetSchemaSql.js';

export const createFullHistoryLedgerCloseMetaRetentionSchemaSql = `
	create table "full_history_ledger_close_meta_source" (
		"id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"base_uri" text not null,
		"config_object_key" text not null,
		"config_digest" bytea not null,
		"config_generation" varchar(256),
		"config_version" varchar(64) not null,
		"compression" varchar(16) not null,
		"ledgers_per_batch" integer not null,
		"batches_per_partition" integer not null,
		"config_bytes" integer not null,
		"config_json" jsonb not null,
		"first_available_ledger" bigint not null,
		"observed_at" timestamptz not null,
		"created_at" timestamptz not null default now(),
		constraint "pk_full_history_lcm_source" primary key ("id"),
		constraint "uq_full_history_lcm_source_config" unique (
			"network_passphrase_hash", "base_uri", "config_object_key",
			"config_digest"
		),
		constraint "uq_full_history_lcm_source_identity" unique (
			"id", "network_passphrase_hash", "config_digest"
		),
		constraint "chk_full_history_lcm_source_hashes" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("config_digest") = 32
		),
		constraint "chk_full_history_lcm_source_text" check (
			length(btrim("base_uri")) between 1 and 2048
			and "base_uri" ~ '^https://'
			and length(btrim("config_object_key")) between 1 and 2048
			and length(btrim("config_version")) between 1 and 64
			and "compression" = 'zstd'
		),
		constraint "chk_full_history_lcm_source_shape" check (
			"ledgers_per_batch" between 1 and 65536
			and "batches_per_partition" between 1 and 1048576
			and "config_bytes" between 2 and 1048576
			and jsonb_typeof("config_json") = 'object'
			and "first_available_ledger" between 1 and 4294967295
		)
	);

	create table "full_history_ledger_close_meta_batch" (
		"id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"source_id" uuid not null,
		"config_digest" bytea not null,
		"start_ledger" bigint not null,
		"end_ledger" bigint not null,
		"ledger_count" integer not null,
		"first_previous_ledger_hash" bytea not null,
		"last_ledger_hash" bytea not null,
		"processing_manifest_sha256" bytea not null,
		"source_disposition" varchar(32) not null,
		"processed_at" timestamptz not null,
		"created_at" timestamptz not null default now(),
		constraint "pk_full_history_lcm_batch" primary key ("id"),
		constraint "uq_full_history_lcm_batch_range" unique (
			"network_passphrase_hash", "start_ledger", "end_ledger"
		),
		constraint "uq_full_history_lcm_batch_identity" unique (
			"id", "network_passphrase_hash"
		),
		constraint "fk_full_history_lcm_batch_source" foreign key (
			"source_id", "network_passphrase_hash", "config_digest"
		) references "full_history_ledger_close_meta_source" (
			"id", "network_passphrase_hash", "config_digest"
		) on delete restrict,
		constraint "chk_full_history_lcm_batch_hashes" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("config_digest") = 32
			and octet_length("first_previous_ledger_hash") = 32
			and octet_length("last_ledger_hash") = 32
			and octet_length("processing_manifest_sha256") = 32
		),
		constraint "chk_full_history_lcm_batch_range" check (
			"start_ledger" between 1 and 4294967295
			and "end_ledger" between "start_ledger" and 4294967295
			and "ledger_count" = "end_ledger" - "start_ledger" + 1
			and "ledger_count" between 64 and 1024
		),
		constraint "chk_full_history_lcm_batch_text" check (
			"source_disposition" = 'discarded-after-processing'
		)
	);

	create index "idx_full_history_lcm_batch_frontier"
		on "full_history_ledger_close_meta_batch" (
			"network_passphrase_hash", "end_ledger" desc
		);

	create table "full_history_ledger_close_meta_source_object" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"source_index" integer not null,
		"start_ledger" bigint not null,
		"end_ledger" bigint not null,
		"ledger_count" integer not null,
		"source_object_key" text not null,
		"source_generation" varchar(1024) not null,
		"source_etag" varchar(512),
		"first_previous_ledger_hash" bytea not null,
		"last_ledger_hash" bytea not null,
		"compressed_sha256" bytea not null,
		"xdr_sha256" bytea not null,
		"compressed_bytes" bigint not null,
		"xdr_bytes" bigint not null,
		constraint "pk_full_history_lcm_source_object" primary key (
			"batch_id", "source_index"
		),
		constraint "uq_full_history_lcm_source_object_range" unique (
			"network_passphrase_hash", "start_ledger", "end_ledger"
		),
		constraint "uq_full_history_lcm_source_object_key" unique (
			"network_passphrase_hash", "source_object_key"
		),
		constraint "fk_full_history_lcm_source_object_batch" foreign key (
			"batch_id", "network_passphrase_hash"
		) references "full_history_ledger_close_meta_batch" (
			"id", "network_passphrase_hash"
		) on delete restrict,
		constraint "chk_full_history_lcm_source_object_hashes" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("compressed_sha256") = 32
			and octet_length("first_previous_ledger_hash") = 32
			and octet_length("last_ledger_hash") = 32
			and octet_length("xdr_sha256") = 32
		),
		constraint "chk_full_history_lcm_source_object_range" check (
			"source_index" between 0 and 65535
			and "start_ledger" between 1 and 4294967295
			and "end_ledger" between "start_ledger" and 4294967295
			and "ledger_count" = "end_ledger" - "start_ledger" + 1
			and "ledger_count" between 1 and 65536
		),
		constraint "chk_full_history_lcm_source_object_sizes" check (
			"compressed_bytes" between 1 and 4294967296
			and "xdr_bytes" between 1 and 17179869184
		),
		constraint "chk_full_history_lcm_source_object_text" check (
			length(btrim("source_object_key")) between 1 and 2048
			and length(btrim("source_generation")) between 1 and 1024
			and "source_object_key" !~ '(^|/)\\.\\.?(/|$)'
		)
	);

	create table "full_history_ledger_close_meta_dataset" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"dataset" varchar(64) not null,
		"media_type" varchar(128) not null,
		"representation" varchar(32) not null,
		"schema_version" varchar(64) not null,
		"record_count" bigint not null,
		"output_bytes" bigint not null,
		"output_sha256" bytea not null,
		"storage_key" text not null,
		constraint "pk_full_history_lcm_dataset" primary key (
			"batch_id", "dataset"
		),
		constraint "uq_full_history_lcm_dataset_storage" unique (
			"network_passphrase_hash", "storage_key"
		),
		constraint "fk_full_history_lcm_dataset_batch" foreign key (
			"batch_id", "network_passphrase_hash"
		) references "full_history_ledger_close_meta_batch" (
			"id", "network_passphrase_hash"
		) on delete restrict,
		constraint "chk_full_history_lcm_dataset_shape" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("output_sha256") = 32
			and length(btrim("dataset")) between 1 and 64
			and length(btrim("media_type")) between 1 and 128
			and "representation" in ('lossless-replay', 'typed-projection')
			and length(btrim("schema_version")) between 1 and 64
			and "record_count" >= 0
			and "output_bytes" > 0
			and length(btrim("storage_key")) between 1 and 2048
			and "storage_key" !~ '(^|/)\\.\\.?(/|$)'
		)
	);

	${createFullHistoryLedgerCloseMetaDatasetContractSql}

	create table "full_history_ledger_close_meta_watermark" (
		"network_passphrase_hash" bytea not null,
		"first_available_ledger" bigint not null,
		"next_ledger" bigint not null,
		"last_batch_id" uuid,
		"version" bigint not null default 0,
		"updated_at" timestamptz not null default now(),
		constraint "pk_full_history_lcm_watermark"
			primary key ("network_passphrase_hash"),
		constraint "fk_full_history_lcm_watermark_batch" foreign key (
			"last_batch_id", "network_passphrase_hash"
		) references "full_history_ledger_close_meta_batch" (
			"id", "network_passphrase_hash"
		) on delete restrict,
		constraint "chk_full_history_lcm_watermark_hash" check (
			octet_length("network_passphrase_hash") = 32
		),
		constraint "chk_full_history_lcm_watermark_position" check (
			"first_available_ledger" between 1 and 4294967295
			and "next_ledger" between "first_available_ledger" and 4294967296
			and "version" >= 0
		),
		constraint "chk_full_history_lcm_watermark_initial" check (
			("last_batch_id" is null
				and "next_ledger" = "first_available_ledger"
				and "version" = 0)
			or ("last_batch_id" is not null
				and "next_ledger" > "first_available_ledger")
		)
	);

	create function reject_full_history_lcm_immutable_mutation()
	returns trigger language plpgsql as $$
	begin
		raise exception 'full-history LedgerCloseMeta provenance is immutable';
	end
	$$;

	create trigger "trg_reject_full_history_lcm_source_mutation"
	before update or delete on "full_history_ledger_close_meta_source"
	for each row execute function reject_full_history_lcm_immutable_mutation();

	create trigger "trg_reject_full_history_lcm_batch_mutation"
	before update or delete on "full_history_ledger_close_meta_batch"
	for each row execute function reject_full_history_lcm_immutable_mutation();

	create trigger "trg_reject_full_history_lcm_source_object_mutation"
	before update or delete on "full_history_ledger_close_meta_source_object"
	for each row execute function reject_full_history_lcm_immutable_mutation();

	create trigger "trg_reject_full_history_lcm_dataset_mutation"
	before update or delete on "full_history_ledger_close_meta_dataset"
	for each row execute function reject_full_history_lcm_immutable_mutation();

	create function assert_full_history_lcm_batch_source_coverage(target uuid)
	returns void language plpgsql as $$
	declare
		batch_record "full_history_ledger_close_meta_batch"%rowtype;
		object_count bigint;
		object_ledgers bigint;
		first_ledger bigint;
		last_ledger bigint;
		has_gap boolean;
		has_hash_gap boolean;
		first_previous_hash bytea;
		last_hash bytea;
	begin
		select * into strict batch_record
		from "full_history_ledger_close_meta_batch" where "id" = target;
		select count(*), coalesce(sum("ledger_count"), 0),
			min("start_ledger"), max("end_ledger")
		into object_count, object_ledgers, first_ledger, last_ledger
		from "full_history_ledger_close_meta_source_object"
		where "batch_id" = target;
		select exists (
			select 1 from (
				select "start_ledger",
					lag("end_ledger") over (order by "source_index") as previous_end
				from "full_history_ledger_close_meta_source_object"
				where "batch_id" = target
			) ordered where previous_end is not null
				and "start_ledger" <> previous_end + 1
		) into has_gap;
		select exists (
			select 1 from (
				select "first_previous_ledger_hash",
					lag("last_ledger_hash") over (order by "source_index") as previous_hash
				from "full_history_ledger_close_meta_source_object"
				where "batch_id" = target
			) ordered where previous_hash is not null
				and "first_previous_ledger_hash" <> previous_hash
		) into has_hash_gap;
		select "first_previous_ledger_hash" into first_previous_hash
		from "full_history_ledger_close_meta_source_object"
		where "batch_id" = target order by "source_index" limit 1;
		select "last_ledger_hash" into last_hash
		from "full_history_ledger_close_meta_source_object"
		where "batch_id" = target order by "source_index" desc limit 1;
		if object_count = 0
			or object_ledgers <> batch_record."ledger_count"
			or first_ledger <> batch_record."start_ledger"
			or last_ledger <> batch_record."end_ledger"
			or has_gap
			or has_hash_gap
			or first_previous_hash <> batch_record."first_previous_ledger_hash"
			or last_hash <> batch_record."last_ledger_hash" then
			raise exception 'full-history LedgerCloseMeta source objects must cover their typed shard exactly';
		end if;
	end
	$$;

	create function validate_full_history_lcm_batch_source_coverage()
	returns trigger language plpgsql as $$
	begin
		perform assert_full_history_lcm_batch_source_coverage(new."id");
		return new;
	end
	$$;

	create function validate_full_history_lcm_source_object_coverage()
	returns trigger language plpgsql as $$
	begin
		perform assert_full_history_lcm_batch_source_coverage(new."batch_id");
		return new;
	end
	$$;

	create constraint trigger "trg_validate_full_history_lcm_batch_sources"
	after insert on "full_history_ledger_close_meta_batch"
	deferrable initially deferred
	for each row execute function validate_full_history_lcm_batch_source_coverage();

	create constraint trigger "trg_validate_full_history_lcm_source_objects"
	after insert on "full_history_ledger_close_meta_source_object"
	deferrable initially deferred
	for each row execute function validate_full_history_lcm_source_object_coverage();

	create function reject_full_history_lcm_batch_overlap()
	returns trigger language plpgsql as $$
	declare
		predecessor "full_history_ledger_close_meta_batch"%rowtype;
		successor "full_history_ledger_close_meta_batch"%rowtype;
	begin
		perform pg_advisory_xact_lock(
			hashtextextended(encode(new."network_passphrase_hash", 'hex'), 0)
		);
		if exists (
			select 1 from "full_history_ledger_close_meta_batch" existing
			where existing."network_passphrase_hash" = new."network_passphrase_hash"
			and existing."start_ledger" <= new."end_ledger"
			and existing."end_ledger" >= new."start_ledger"
		) then
			 raise exception 'full-history LedgerCloseMeta batch ranges may not overlap';
		end if;
		select * into predecessor
		from "full_history_ledger_close_meta_batch"
		where "network_passphrase_hash" = new."network_passphrase_hash"
			and "end_ledger" + 1 = new."start_ledger";
		if found and predecessor."last_ledger_hash" <>
				new."first_previous_ledger_hash" then
			raise exception 'full-history LedgerCloseMeta predecessor hash does not link';
		end if;
		select * into successor
		from "full_history_ledger_close_meta_batch"
		where "network_passphrase_hash" = new."network_passphrase_hash"
			and "start_ledger" = new."end_ledger" + 1;
		if found and new."last_ledger_hash" <>
				successor."first_previous_ledger_hash" then
			raise exception 'full-history LedgerCloseMeta successor hash does not link';
		end if;
		return new;
	end
	$$;

	create trigger "trg_reject_full_history_lcm_batch_overlap"
	before insert on "full_history_ledger_close_meta_batch"
	for each row execute function reject_full_history_lcm_batch_overlap();

	create function validate_full_history_lcm_watermark_advance()
	returns trigger language plpgsql as $$
	declare
		batch_record "full_history_ledger_close_meta_batch"%rowtype;
		previous_batch "full_history_ledger_close_meta_batch"%rowtype;
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history LedgerCloseMeta watermark deletion is prohibited';
		end if;
		if tg_op = 'INSERT' then
			if new."last_batch_id" is not null
				or new."next_ledger" <> new."first_available_ledger"
				or new."version" <> 0 then
				raise exception 'full-history LedgerCloseMeta watermark must start at its first available ledger';
			end if;
			return new;
		end if;
		if new."network_passphrase_hash" <> old."network_passphrase_hash"
			or new."first_available_ledger" <> old."first_available_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark identity is immutable';
		end if;
		if new."version" <> old."version" + 1 then
			raise exception 'full-history LedgerCloseMeta watermark version must advance once';
		end if;
		select * into strict batch_record
		from "full_history_ledger_close_meta_batch"
		where "id" = new."last_batch_id" for key share;
		if batch_record."network_passphrase_hash" <>
				new."network_passphrase_hash"
			or batch_record."start_ledger" <> old."next_ledger"
			or batch_record."end_ledger" + 1 <> new."next_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark must advance one contiguous batch';
		end if;
		if old."last_batch_id" is not null then
			select * into strict previous_batch
			from "full_history_ledger_close_meta_batch"
			where "id" = old."last_batch_id" for key share;
			if previous_batch."last_ledger_hash" <>
					batch_record."first_previous_ledger_hash" then
				raise exception 'full-history LedgerCloseMeta watermark chain hash does not link';
			end if;
		end if;
		perform assert_full_history_lcm_batch_dataset_set(new."last_batch_id");
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_watermark_advance"
	before insert or update or delete
		on "full_history_ledger_close_meta_watermark"
	for each row execute function validate_full_history_lcm_watermark_advance()
`;

export const dropFullHistoryLedgerCloseMetaRetentionSchemaSql = `
	drop table "full_history_ledger_close_meta_watermark";
	drop table "full_history_ledger_close_meta_dataset";
	drop table "full_history_ledger_close_meta_source_object";
	drop table "full_history_ledger_close_meta_batch";
	drop table "full_history_ledger_close_meta_source";
	${dropFullHistoryLedgerCloseMetaDatasetContractSql}
	drop function validate_full_history_lcm_watermark_advance();
	drop function reject_full_history_lcm_batch_overlap();
	drop function validate_full_history_lcm_source_object_coverage();
	drop function validate_full_history_lcm_batch_source_coverage();
	drop function assert_full_history_lcm_batch_source_coverage(uuid);
	drop function reject_full_history_lcm_immutable_mutation()
`;
