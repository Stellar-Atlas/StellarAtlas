export const createFullHistoryIngestionBatchSql = `
	create table "full_history_ingestion_batch" (
		"id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"checkpoint_proof_id" integer not null,
		"proof_version" smallint not null,
		"proof_evaluated_at" timestamptz not null,
		"archive_url_identity" text not null,
		"checkpoint_ledger" bigint not null,
		"first_ledger" bigint not null,
		"last_ledger" bigint not null,
		"checkpoint_state_object_remote_id" uuid not null,
		"checkpoint_state_content_digest" bytea not null,
		"ledger_object_remote_id" uuid not null,
		"ledger_content_digest" bytea not null,
		"transactions_object_remote_id" uuid not null,
		"transactions_content_digest" bytea not null,
		"results_object_remote_id" uuid not null,
		"results_content_digest" bytea not null,
		"decoder_version" varchar(128) not null,
		"ledger_count" integer not null,
		"transaction_count" integer not null,
		"result_count" integer not null,
		"ingested_at" timestamptz not null default now(),
		constraint "pk_full_history_ingestion_batch" primary key ("id"),
		constraint "uq_full_history_batch_network_identity"
			unique ("id", "network_passphrase_hash"),
		constraint "uq_full_history_batch_network_checkpoint"
			unique ("network_passphrase_hash", "checkpoint_ledger"),
		constraint "uq_full_history_batch_proof" unique ("checkpoint_proof_id"),
		constraint "fk_full_history_batch_checkpoint_proof"
			foreign key ("checkpoint_proof_id")
			references "history_archive_checkpoint_proof" ("id") on delete restrict,
		constraint "fk_full_history_batch_checkpoint_object"
			foreign key ("checkpoint_state_object_remote_id")
			references "history_archive_object_queue" ("remoteId") on delete restrict,
		constraint "fk_full_history_batch_ledger_object"
			foreign key ("ledger_object_remote_id")
			references "history_archive_object_queue" ("remoteId") on delete restrict,
		constraint "fk_full_history_batch_transactions_object"
			foreign key ("transactions_object_remote_id")
			references "history_archive_object_queue" ("remoteId") on delete restrict,
		constraint "fk_full_history_batch_results_object"
			foreign key ("results_object_remote_id")
			references "history_archive_object_queue" ("remoteId") on delete restrict,
		constraint "chk_full_history_batch_hash_lengths" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("checkpoint_state_content_digest") = 32
			and octet_length("ledger_content_digest") = 32
			and octet_length("transactions_content_digest") = 32
			and octet_length("results_content_digest") = 32
		),
		constraint "chk_full_history_batch_range" check (
			"checkpoint_ledger" = "last_ledger"
			and "last_ledger" between 63 and 4294967295
			and mod("checkpoint_ledger", 64) = 63
			and (
				("checkpoint_ledger" = 63 and "first_ledger" = 1)
				or (
					"checkpoint_ledger" > 63
					and "last_ledger" - "first_ledger" = 63
				)
			)
		),
		constraint "chk_full_history_batch_counts" check (
			"ledger_count" = case
				when "checkpoint_ledger" = 63 then 63 else 64
			end
			and "transaction_count" between 0 and 100000
			and "result_count" = "transaction_count"
		),
		constraint "chk_full_history_batch_proof_version"
			check ("proof_version" between 1 and 32767),
		constraint "chk_full_history_batch_text" check (
			length(btrim("archive_url_identity")) > 0
			and length(btrim("decoder_version")) > 0
		)
	)
`;

export const createFullHistoryLedgerSql = `
	create table "full_history_ledger" (
		"network_passphrase_hash" bytea not null,
		"ledger_sequence" bigint not null,
		"batch_id" uuid not null,
		"ledger_hash" bytea not null,
		"previous_ledger_hash" bytea not null,
		"transaction_set_hash" bytea not null,
		"transaction_result_hash" bytea not null,
		"bucket_list_hash" bytea not null,
		"protocol_version" integer not null,
		"closed_at" timestamptz not null,
		"transaction_count" integer not null,
		constraint "pk_full_history_ledger"
			primary key ("network_passphrase_hash", "ledger_sequence"),
		constraint "uq_full_history_ledger_hash"
			unique ("network_passphrase_hash", "ledger_hash"),
		constraint "uq_full_history_ledger_batch_identity"
			unique ("batch_id", "network_passphrase_hash", "ledger_sequence"),
		constraint "fk_full_history_ledger_batch"
			foreign key ("batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch"
				("id", "network_passphrase_hash") on delete restrict,
		constraint "chk_full_history_ledger_hash_lengths" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("ledger_hash") = 32
			and octet_length("previous_ledger_hash") = 32
			and octet_length("transaction_set_hash") = 32
			and octet_length("transaction_result_hash") = 32
			and octet_length("bucket_list_hash") = 32
		),
		constraint "chk_full_history_ledger_values" check (
			"ledger_sequence" between 0 and 4294967295
			and "protocol_version" > 0
			and "transaction_count" >= 0
		)
	)
`;

export const createFullHistoryTransactionSql = `
	create table "full_history_transaction" (
		"network_passphrase_hash" bytea not null,
		"transaction_hash" bytea not null,
		"batch_id" uuid not null,
		"ledger_sequence" bigint not null,
		"transaction_index" integer not null,
		"envelope_type" text not null,
		"source_account" text not null,
		"source_account_sequence" bigint not null,
		"fee_bid" bigint not null,
		"operation_count" integer not null,
		constraint "pk_full_history_transaction"
			primary key ("network_passphrase_hash", "transaction_hash"),
		constraint "uq_full_history_transaction_position"
			unique (
				"network_passphrase_hash", "ledger_sequence", "transaction_index"
			),
		constraint "uq_full_history_transaction_batch_identity"
			unique ("batch_id", "network_passphrase_hash", "transaction_hash"),
		constraint "uq_full_history_transaction_result_identity"
			unique (
				"batch_id", "network_passphrase_hash", "ledger_sequence",
				"transaction_index", "transaction_hash"
			),
		constraint "fk_full_history_transaction_ledger"
			foreign key ("batch_id", "network_passphrase_hash", "ledger_sequence")
			references "full_history_ledger"
				("batch_id", "network_passphrase_hash", "ledger_sequence")
			on delete restrict,
		constraint "chk_full_history_transaction_hash_lengths" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("transaction_hash") = 32
		),
		constraint "chk_full_history_transaction_values" check (
			"ledger_sequence" between 0 and 4294967295
			and "transaction_index" >= 0
			and "source_account_sequence" >= 0
			and "fee_bid" >= 0
			and "operation_count" >= 0
			and length(btrim("source_account")) > 0
			and "envelope_type" in ('tx-v0', 'tx', 'fee-bump')
		)
	)
`;

export const createFullHistoryTransactionResultSql = `
	create table "full_history_transaction_result" (
		"network_passphrase_hash" bytea not null,
		"transaction_hash" bytea not null,
		"ledger_sequence" bigint not null,
		"transaction_index" integer not null,
		"batch_id" uuid not null,
		"fee_charged" bigint not null,
		"successful" boolean not null,
		"result_code" integer not null,
		"operation_result_count" integer not null,
		constraint "pk_full_history_transaction_result"
			primary key (
				"network_passphrase_hash", "ledger_sequence",
				"transaction_index", "transaction_hash"
			),
		constraint "uq_full_history_result_hash"
			unique ("network_passphrase_hash", "transaction_hash"),
		constraint "fk_full_history_result_transaction"
			foreign key (
				"batch_id", "network_passphrase_hash", "ledger_sequence",
				"transaction_index", "transaction_hash"
			)
			references "full_history_transaction"
				(
					"batch_id", "network_passphrase_hash", "ledger_sequence",
					"transaction_index", "transaction_hash"
				)
			on delete restrict,
		constraint "chk_full_history_result_hash_lengths" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("transaction_hash") = 32
		),
		constraint "chk_full_history_result_values" check (
			"ledger_sequence" between 0 and 4294967295
			and "transaction_index" >= 0
			and "fee_charged" >= 0
			and "operation_result_count" >= 0
		)
	)
`;

export const createFullHistoryWatermarkSql = `
	create table "full_history_watermark" (
		"network_passphrase_hash" bytea not null,
		"next_ledger" bigint not null,
		"last_batch_id" uuid not null,
		"updated_at" timestamptz not null default now(),
		constraint "pk_full_history_watermark"
			primary key ("network_passphrase_hash"),
		constraint "uq_full_history_watermark_batch" unique ("last_batch_id"),
		constraint "fk_full_history_watermark_batch"
			foreign key ("last_batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch"
				("id", "network_passphrase_hash") on delete restrict,
		constraint "chk_full_history_watermark_hash_length"
			check (octet_length("network_passphrase_hash") = 32),
		constraint "chk_full_history_watermark_next"
			check ("next_ledger" between 0 and 4294967296)
	)
`;

export const createFullHistoryReadIndexesSql = `
	create index "idx_full_history_ledger_closed_at"
		on "full_history_ledger" ("network_passphrase_hash", "closed_at" desc);
	create index "idx_full_history_transaction_ledger"
		on "full_history_transaction"
			("network_passphrase_hash", "ledger_sequence", "transaction_index")
`;

export const createFullHistoryVerifiedSourceFunctionSql = `
	create function full_history_verified_source_matches(
		p_remote_id uuid,
		p_object_type text,
		p_archive_url_identity text,
		p_checkpoint_ledger bigint,
		p_content_digest bytea,
		p_representation text
	) returns boolean
	language sql
	stable
	as $function$
		select exists (
			select 1
			from "history_archive_object_queue" source
			where source."remoteId" = p_remote_id
				and source."objectType" = p_object_type
				and source."archiveUrlIdentity" = p_archive_url_identity
				and source."checkpointLedger"::bigint = p_checkpoint_ledger
				and source.status = 'verified'
				and source."verificationFacts" -> 'content' ->> 'algorithm' = 'sha256'
				and source."verificationFacts" -> 'content' ->> 'representation' =
					p_representation
				and case
					when lower(coalesce(
						source."verificationFacts" -> 'content' ->> 'digest', ''
					)) ~ '^[0-9a-f]{64}$'
					then decode(lower(
						source."verificationFacts" -> 'content' ->> 'digest'
					), 'hex')
					else null
				end = p_content_digest
		)
	$function$
`;

function composeFullHistoryBatchProofFunctionSql(
	proofTimestampPredicate: string
): string {
	return `
	create or replace function validate_full_history_batch_provenance()
	returns trigger
	language plpgsql
	as $function$
	begin
		if not exists (
			select 1
			from "history_archive_checkpoint_proof" proof
			where proof."id" = new."checkpoint_proof_id"
				and proof."status" = 'verified'
				and proof."proofVersion" >= 6
				and proof."failureKind" is null
				and proof."requiredObjectsComplete"
				and proof."proofFactsComplete"
				and proof."checkpointBucketListMatches"
				and proof."transactionsMatch"
				and proof."resultsMatch"
				and proof."previousLedgersMatch"
				and proof."bucketsVerified"
				and proof."ledgerFactCount" = new."ledger_count"
				and proof."transactionFactCount" = new."ledger_count"
				and proof."resultFactCount" = new."ledger_count"
				and proof."proofVersion" = new."proof_version"
				and proof.details ->> 'checkpointStateLedgerFactPresent' = 'true'
				and proof.details ->> 'checkpointStateLedgerMatches' = 'true'
				and ${proofTimestampPredicate}
				and proof."archiveUrlIdentity" = new."archive_url_identity"
				and proof."checkpointLedger"::bigint = new."checkpoint_ledger"
				and proof."checkpointStateObjectRemoteId" =
					new."checkpoint_state_object_remote_id"
				and proof."ledgerObjectRemoteId" = new."ledger_object_remote_id"
				and proof."transactionsObjectRemoteId" =
					new."transactions_object_remote_id"
				and proof."resultsObjectRemoteId" = new."results_object_remote_id"
				and nullif(proof.details ->> 'networkPassphrase', '') is not null
				and sha256(convert_to(
					proof.details ->> 'networkPassphrase', 'UTF8'
				)) = new."network_passphrase_hash"
		) then
			raise exception 'full-history batch requires an exact verified proof'
				using errcode = '23514';
		end if;

		if not full_history_verified_source_matches(
			new."checkpoint_state_object_remote_id", 'checkpoint-state',
			new."archive_url_identity", new."checkpoint_ledger",
			new."checkpoint_state_content_digest", 'canonical-json'
		) or not full_history_verified_source_matches(
			new."ledger_object_remote_id", 'ledger', new."archive_url_identity",
			new."checkpoint_ledger", new."ledger_content_digest", 'uncompressed-xdr'
		) or not full_history_verified_source_matches(
			new."transactions_object_remote_id", 'transactions',
			new."archive_url_identity", new."checkpoint_ledger",
			new."transactions_content_digest", 'uncompressed-xdr'
		) or not full_history_verified_source_matches(
			new."results_object_remote_id", 'results', new."archive_url_identity",
			new."checkpoint_ledger", new."results_content_digest", 'uncompressed-xdr'
		) then
			raise exception 'full-history batch source evidence is not verified'
				using errcode = '23514';
		end if;
		return new;
	end
	$function$;
	`;
}

export const createFullHistoryBatchProofFunctionSql =
	composeFullHistoryBatchProofFunctionSql(
		`date_trunc('milliseconds', proof."evaluatedAt") =
			new."proof_evaluated_at"`
	);

export const createFullHistoryBatchProofExactTimestampFunctionSql =
	composeFullHistoryBatchProofFunctionSql(
		'proof."evaluatedAt" = new."proof_evaluated_at"'
	);

export const createFullHistoryBatchProofTriggerSql = `
	${createFullHistoryBatchProofFunctionSql}
	create trigger "trg_validate_full_history_batch_provenance"
	before insert on "full_history_ingestion_batch"
	for each row execute function validate_full_history_batch_provenance()
`;

export const createFullHistoryBatchImmutableTriggerSql = `
	create function reject_full_history_batch_mutation()
	returns trigger
	language plpgsql
	as $function$
	begin
		raise exception 'full-history ingestion batch provenance is immutable'
			using errcode = '55000';
	end
	$function$;

	create trigger "trg_reject_full_history_batch_mutation"
	before update or delete on "full_history_ingestion_batch"
	for each row execute function reject_full_history_batch_mutation()
`;

export const createFullHistoryWatermarkTriggerSql = `
	create function validate_full_history_watermark_advance()
	returns trigger
	language plpgsql
	as $function$
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history watermark deletion is prohibited'
				using errcode = '55000';
		end if;

		if tg_op = 'INSERT' then
			if not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" = new."network_passphrase_hash"
					and batch."last_ledger" + 1 = new."next_ledger"
			) then
				raise exception 'full-history watermark has no committed batch'
					using errcode = '23514';
			end if;
			return new;
		end if;

		if new."network_passphrase_hash" <> old."network_passphrase_hash"
			or new."next_ledger" <= old."next_ledger"
			or not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" = new."network_passphrase_hash"
					and batch."first_ledger" = old."next_ledger"
					and batch."last_ledger" + 1 = new."next_ledger"
			)
		then
			raise exception 'full-history watermark must advance contiguously'
				using errcode = '23514';
		end if;
		return new;
	end
	$function$;

	create trigger "trg_validate_full_history_watermark_advance"
	before insert or update or delete on "full_history_watermark"
	for each row execute function validate_full_history_watermark_advance()
`;

export const dropFullHistoryCanonicalSchemaSql = `
	drop table if exists "full_history_watermark";
	drop table if exists "full_history_transaction_result";
	drop table if exists "full_history_transaction";
	drop table if exists "full_history_ledger";
	drop table if exists "full_history_ingestion_batch";
	drop function if exists validate_full_history_watermark_advance();
	drop function if exists reject_full_history_batch_mutation();
	drop function if exists validate_full_history_batch_provenance();
	drop function if exists full_history_verified_source_matches(
		uuid, text, text, bigint, bytea, text
	)
`;
