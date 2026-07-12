import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

const createOperationFactsSql = `
	create table "full_history_operation" (
		"network_passphrase_hash" bytea not null,
		"transaction_hash" bytea not null,
		"operation_index" integer not null,
		"batch_id" uuid not null,
		"ledger_sequence" bigint not null,
		"transaction_index" integer not null,
		"operation_type" text not null,
		"source_account" text not null,
		"source_account_origin" text not null,
		"fact_scope" text not null,
		constraint "pk_full_history_operation" primary key (
			"network_passphrase_hash", "transaction_hash", "operation_index"
		),
		constraint "fk_full_history_operation_transaction" foreign key (
			"batch_id", "network_passphrase_hash", "ledger_sequence",
			"transaction_index", "transaction_hash"
		) references "full_history_transaction" (
			"batch_id", "network_passphrase_hash", "ledger_sequence",
			"transaction_index", "transaction_hash"
		) on delete restrict,
		constraint "chk_full_history_operation_hash_lengths" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("transaction_hash") = 32
		),
		constraint "chk_full_history_operation_position" check (
			"ledger_sequence" between 0 and 4294967295
			and "transaction_index" >= 0
			and "operation_index" >= 0
		),
		constraint "chk_full_history_operation_type" check (
			"operation_type" in (
				'account_merge', 'allow_trust',
				'begin_sponsoring_future_reserves', 'bump_sequence',
				'change_trust', 'claim_claimable_balance', 'clawback',
				'clawback_claimable_balance', 'create_account',
				'create_claimable_balance', 'create_passive_sell_offer',
				'end_sponsoring_future_reserves', 'extend_footprint_ttl',
				'inflation', 'invoke_host_function', 'liquidity_pool_deposit',
				'liquidity_pool_withdraw', 'manage_buy_offer', 'manage_data',
				'manage_sell_offer', 'path_payment_strict_receive',
				'path_payment_strict_send', 'payment', 'restore_footprint',
				'revoke_sponsorship', 'set_options', 'set_trust_line_flags'
			)
		),
		constraint "chk_full_history_operation_source" check (
			length(btrim("source_account")) between 1 and 128
			and "source_account_origin" in ('operation', 'transaction')
		),
		constraint "chk_full_history_operation_scope" check (
			"fact_scope" = 'operation_body_and_envelope'
		)
	);

	comment on table "full_history_operation" is
		'Proof-gated operation body/envelope facts; no execution outcome, effect, event, or raw XDR';

	create table "full_history_operation_batch_coverage" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"first_ledger" bigint not null,
		"last_ledger" bigint not null,
		"transaction_count" integer not null,
		"operation_count" integer not null,
		"fact_scope" text not null,
		constraint "pk_full_history_operation_batch_coverage"
			primary key ("batch_id"),
		constraint "fk_full_history_operation_batch_coverage_batch"
			foreign key ("batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch" (
				id, "network_passphrase_hash"
			) on delete restrict,
		constraint "chk_full_history_operation_batch_coverage_hash" check (
			octet_length("network_passphrase_hash") = 32
		),
		constraint "chk_full_history_operation_batch_coverage_range" check (
			"first_ledger" between 0 and 4294967295
			and "last_ledger" between "first_ledger" and 4294967295
			and "transaction_count" >= 0
			and "operation_count" >= 0
		),
		constraint "chk_full_history_operation_batch_coverage_scope" check (
			"fact_scope" = 'operation_body_and_envelope'
		)
	);

	comment on table "full_history_operation_batch_coverage" is
		'Explicit operation-index coverage; absent rows mean the canonical batch is not indexed';

	create index "idx_full_history_operation_type_ledger"
		on "full_history_operation" (
			"network_passphrase_hash", "operation_type",
			"ledger_sequence" desc, "transaction_index" desc,
			"operation_index"
		);
	create index "idx_full_history_operation_source_ledger"
		on "full_history_operation" (
			"network_passphrase_hash", "source_account",
			"ledger_sequence" desc, "transaction_index" desc,
			"operation_index"
		);
	create index "idx_full_history_operation_ledger"
		on "full_history_operation" (
			"network_passphrase_hash", "ledger_sequence" desc,
			"transaction_index" desc, "operation_index"
		);
	create index "idx_full_history_operation_coverage_network"
		on "full_history_operation_batch_coverage" (
			"network_passphrase_hash", "first_ledger", "last_ledger"
		);

	create function reject_full_history_operation_mutation()
	returns trigger
	language plpgsql
	as $function$
	begin
		raise exception 'full-history operation facts are immutable'
			using errcode = '55000';
	end
	$function$;

	create trigger "trg_reject_full_history_operation_mutation"
	before update or delete on "full_history_operation"
	for each row execute function reject_full_history_operation_mutation();

	create trigger "trg_reject_full_history_operation_coverage_mutation"
	before update or delete on "full_history_operation_batch_coverage"
	for each row execute function reject_full_history_operation_mutation()
`;

export class FullHistoryOperationFactsMigration1784960000000 implements MigrationInterface {
	name = 'FullHistoryOperationFactsMigration1784960000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createOperationFactsSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(
			'drop table "full_history_operation_batch_coverage"'
		);
		await queryRunner.query('drop table "full_history_operation"');
		await queryRunner.query(
			'drop function reject_full_history_operation_mutation()'
		);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history operation facts migration requires an active transaction'
		);
	}
}
