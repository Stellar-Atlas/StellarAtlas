import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

const createOperationAccountReferencesSql = `
	create table "full_history_operation_account_reference" (
		"network_passphrase_hash" bytea not null,
		"transaction_hash" bytea not null,
		"operation_index" integer not null,
		"role" text not null,
		"account_id" text not null,
		"base_account_id" text not null,
		"fact_scope" text not null,
		constraint "pk_full_history_operation_account_reference" primary key (
			"network_passphrase_hash", "transaction_hash", "operation_index",
			"role", "account_id"
		),
		constraint "fk_full_history_operation_account_reference_operation"
			foreign key (
				"network_passphrase_hash", "transaction_hash", "operation_index"
			) references "full_history_operation" (
				"network_passphrase_hash", "transaction_hash", "operation_index"
			) on delete restrict,
		constraint "chk_full_history_operation_account_reference_hashes" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("transaction_hash") = 32
		),
		constraint "chk_full_history_operation_account_reference_position" check (
			"operation_index" >= 0
		),
		constraint "chk_full_history_operation_account_reference_role" check (
			"role" in (
				'claimant', 'clawback_source', 'destination', 'effective_source',
				'inflation_destination', 'offer_seller', 'sponsored_account',
				'sponsorship_account', 'trustor'
			)
		),
		constraint "chk_full_history_operation_account_reference_accounts" check (
			length(btrim("account_id")) between 1 and 128
			and length(btrim("base_account_id")) between 1 and 128
		),
		constraint "chk_full_history_operation_account_reference_scope" check (
			"fact_scope" = 'operation_body_and_envelope_account_references'
		)
	);

	comment on table "full_history_operation_account_reference" is
		'Immutable G/M-normalized account participants decoded from canonical operation envelope XDR; no copied XDR, state, effect, signer, auth, or asset issuer';

	create table "full_history_operation_account_reference_batch_coverage" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"first_ledger" bigint not null,
		"last_ledger" bigint not null,
		"operation_count" integer not null,
		"account_reference_count" integer not null,
		"fact_scope" text not null,
		"reference_decoder_version" varchar(128) not null,
		constraint "pk_full_history_operation_account_reference_coverage"
			primary key ("batch_id"),
		constraint "fk_full_history_operation_account_reference_coverage_batch"
			foreign key ("batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch" (
				id, "network_passphrase_hash"
			) on delete restrict,
		constraint "fk_full_history_operation_account_reference_coverage_operations"
			foreign key ("batch_id")
			references "full_history_operation_batch_coverage" ("batch_id")
			on delete restrict,
		constraint "chk_full_history_operation_account_reference_coverage_hash"
			check (octet_length("network_passphrase_hash") = 32),
		constraint "chk_full_history_operation_account_reference_coverage_range"
			check (
				"first_ledger" between 0 and 4294967295
				and "last_ledger" between "first_ledger" and 4294967295
				and "operation_count" >= 0
				and "account_reference_count" >= "operation_count"
			),
		constraint "chk_full_history_operation_account_reference_coverage_scope"
			check (
				"fact_scope" =
					'operation_body_and_envelope_account_references'
			),
		constraint "chk_full_history_operation_account_reference_coverage_decoder"
			check (length(btrim("reference_decoder_version")) between 1 and 128)
	);

	comment on table "full_history_operation_account_reference_batch_coverage" is
		'Explicit complete envelope account-reference coverage, including zero-operation batches';

	create index "idx_full_history_operation_account_reference_base"
		on "full_history_operation_account_reference" (
			"network_passphrase_hash", "base_account_id",
			"transaction_hash", "operation_index"
		);
	create index "idx_full_history_operation_account_reference_exact"
		on "full_history_operation_account_reference" (
			"network_passphrase_hash", "account_id",
			"transaction_hash", "operation_index"
		);
	create index "idx_full_history_operation_account_reference_coverage_network"
		on "full_history_operation_account_reference_batch_coverage" (
			"network_passphrase_hash", "first_ledger", "last_ledger"
		);

	create trigger "trg_reject_full_history_operation_account_reference_mutation"
	before update or delete on "full_history_operation_account_reference"
	for each row execute function reject_full_history_operation_mutation();

	create trigger
		"trg_reject_full_history_operation_account_ref_cov_mutation"
	before update or delete
		on "full_history_operation_account_reference_batch_coverage"
	for each row execute function reject_full_history_operation_mutation()
`;

export class FullHistoryOperationAccountReferenceMigration1785040000000 implements MigrationInterface {
	readonly name = 'FullHistoryOperationAccountReferenceMigration1785040000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createOperationAccountReferencesSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(
			'drop table "full_history_operation_account_reference_batch_coverage"'
		);
		await queryRunner.query(
			'drop table "full_history_operation_account_reference"'
		);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history operation account-reference migration requires an active transaction'
		);
	}
}
