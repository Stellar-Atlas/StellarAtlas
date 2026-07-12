import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

const createOperationResultsSql = `
	create table "full_history_operation_result" (
		"network_passphrase_hash" bytea not null,
		"transaction_hash" bytea not null,
		"operation_index" integer not null,
		"outcome" text not null,
		"operation_result_code" integer,
		"operation_specific_result_code" integer,
		"fact_scope" text not null,
		constraint "pk_full_history_operation_result" primary key (
			"network_passphrase_hash", "transaction_hash", "operation_index"
		),
		constraint "fk_full_history_operation_result_operation" foreign key (
			"network_passphrase_hash", "transaction_hash", "operation_index"
		) references "full_history_operation" (
			"network_passphrase_hash", "transaction_hash", "operation_index"
		) on delete restrict,
		constraint "chk_full_history_operation_result_hashes" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("transaction_hash") = 32
		),
		constraint "chk_full_history_operation_result_position" check (
			"operation_index" >= 0
		),
		constraint "chk_full_history_operation_result_scope" check (
			"fact_scope" = 'transaction_result_xdr'
		),
		constraint "chk_full_history_operation_result_codes" check (
			("operation_result_code" is null or
				"operation_result_code" between -6 and 0)
			and ("operation_specific_result_code" is null or
				"operation_specific_result_code" between -2147483648 and 2147483647)
		),
		constraint "chk_full_history_operation_result_outcome" check (
			("outcome" = 'not_applied'
				and "operation_result_code" is null
				and "operation_specific_result_code" is null)
			or ("outcome" = 'succeeded'
				and "operation_result_code" = 0
				and "operation_specific_result_code" = 0)
			or ("outcome" = 'failed' and (
				("operation_result_code" between -6 and -1
					and "operation_specific_result_code" is null)
				or ("operation_result_code" = 0
					and "operation_specific_result_code" is not null
					and "operation_specific_result_code" <> 0)
			))
		)
	);

	comment on table "full_history_operation_result" is
		'One typed TransactionResult XDR outcome per proof-gated canonical operation; no copied XDR';

	create table "full_history_operation_result_batch_coverage" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"first_ledger" bigint not null,
		"last_ledger" bigint not null,
		"operation_count" integer not null,
		"fact_scope" text not null,
		"result_decoder_version" varchar(128) not null,
		constraint "pk_full_history_operation_result_coverage"
			primary key ("batch_id"),
		constraint "fk_full_history_operation_result_coverage_batch"
			foreign key ("batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch" (
				id, "network_passphrase_hash"
			) on delete restrict,
		constraint "chk_full_history_operation_result_coverage_hash" check (
			octet_length("network_passphrase_hash") = 32
		),
		constraint "chk_full_history_operation_result_coverage_range" check (
			"first_ledger" between 0 and 4294967295
			and "last_ledger" between "first_ledger" and 4294967295
			and "operation_count" >= 0
		),
		constraint "chk_full_history_operation_result_coverage_scope" check (
			"fact_scope" = 'transaction_result_xdr'
		),
		constraint "chk_full_history_operation_result_coverage_decoder" check (
			length(btrim("result_decoder_version")) between 1 and 128
		)
	);

	comment on table "full_history_operation_result_batch_coverage" is
		'Explicit complete operation-result coverage, including zero-operation batches';

	create index "idx_full_history_operation_result_coverage_network"
		on "full_history_operation_result_batch_coverage" (
			"network_passphrase_hash", "first_ledger", "last_ledger"
		);

	create trigger "trg_reject_full_history_operation_result_mutation"
	before update or delete on "full_history_operation_result"
	for each row execute function reject_full_history_operation_mutation();

	create trigger "trg_reject_full_history_operation_result_coverage_mutation"
	before update or delete on "full_history_operation_result_batch_coverage"
	for each row execute function reject_full_history_operation_mutation()
`;

export class FullHistoryOperationResultMigration1785010000000 implements MigrationInterface {
	readonly name = 'FullHistoryOperationResultMigration1785010000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createOperationResultsSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(
			'drop table "full_history_operation_result_batch_coverage"'
		);
		await queryRunner.query('drop table "full_history_operation_result"');
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history operation-result migration requires an active transaction'
		);
	}
}
