import type { DataSource } from 'typeorm';

export interface ImmutableRowSnapshot {
	readonly identity: string;
	readonly xmin: string;
}

export class FullHistoryOperationBackfillPostgresAssertions {
	constructor(private readonly dataSource: DataSource) {}

	async coverageCount(): Promise<number> {
		const rows = await this.dataSource.query<Array<{ readonly count: number }>>(
			`select count(*)::integer as count
			 from "full_history_operation_batch_coverage"`
		);
		return rows[0]?.count ?? -1;
	}

	async batchProgress(batchId: string): Promise<{
		readonly accountReferenceCount: number;
		readonly accountReferenceCoverageCount: number;
		readonly coverageCount: number;
		readonly operationCount: number;
	}> {
		const rows = await this.dataSource.query<
			Array<{
				readonly accountReferenceCount: number;
				readonly accountReferenceCoverageCount: number;
				readonly coverageCount: number;
				readonly operationCount: number;
			}>
		>(
			`select
				(select count(*)::integer
				 from "full_history_operation_account_reference_batch_coverage"
				 where "batch_id" = $1) as "accountReferenceCoverageCount",
				(select count(*)::integer
				 from "full_history_operation_account_reference" reference
				 join "full_history_operation" operation
					on operation."network_passphrase_hash" =
						reference."network_passphrase_hash"
					and operation."transaction_hash" =
						reference."transaction_hash"
					and operation."operation_index" = reference."operation_index"
				 where operation."batch_id" = $1) as "accountReferenceCount",
				(select count(*)::integer
				 from "full_history_operation_batch_coverage"
				 where "batch_id" = $1) as "coverageCount",
				(select count(*)::integer from "full_history_operation"
				 where "batch_id" = $1) as "operationCount"`,
			[batchId]
		);
		return (
			rows[0] ?? {
				accountReferenceCount: -1,
				accountReferenceCoverageCount: -1,
				coverageCount: -1,
				operationCount: -1
			}
		);
	}

	async installSlowReferenceCoverageTrigger(): Promise<void> {
		await this.dataSource.query(`
			create function full_history_operation_backfill_test_timeout()
			returns trigger language plpgsql as $function$
			begin
				perform pg_sleep(1);
				return new;
			end
			$function$
		`);
		await this.dataSource.query(`
			create trigger full_history_operation_backfill_test_timeout
			before insert on
				"full_history_operation_account_reference_batch_coverage"
			for each row execute function
				full_history_operation_backfill_test_timeout()
		`);
	}

	async removeSlowReferenceCoverageTrigger(): Promise<void> {
		await this.dataSource.query(`
			drop trigger if exists full_history_operation_backfill_test_timeout
			on "full_history_operation_account_reference_batch_coverage"
		`);
		await this.dataSource.query(`
			drop function if exists full_history_operation_backfill_test_timeout()
		`);
	}

	async immutableRows(): Promise<ImmutableRowSnapshot[]> {
		return this.dataSource.query<ImmutableRowSnapshot[]>(`
			select 'batch:' || id::text as identity, xmin::text as xmin
			from "full_history_ingestion_batch"
			union all
			select 'transaction:' || encode("transaction_hash", 'hex'),
				xmin::text as xmin
			from "full_history_transaction"
			order by identity
		`);
	}

	async operationRows() {
		return this.dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationType: string;
				readonly sourceAccount: string;
				readonly sourceAccountOrigin: string;
				readonly transactionHash: string;
			}>
		>(`
			select "batch_id" as "batchId", "operation_type" as "operationType",
				"source_account" as "sourceAccount",
				"source_account_origin" as "sourceAccountOrigin",
				encode("transaction_hash", 'hex') as "transactionHash"
			from "full_history_operation"
			order by "operation_type"
		`);
	}

	async operationCoverageRows() {
		return this.dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationCount: number;
				readonly operationDecoderVersion: string;
				readonly transactionCount: number;
			}>
		>(`
			select coverage."batch_id" as "batchId",
				coverage."operation_count" as "operationCount",
				coverage."operation_decoder_version" as "operationDecoderVersion",
				coverage."transaction_count" as "transactionCount"
			from "full_history_operation_batch_coverage" coverage
			join "full_history_ingestion_batch" batch
				on batch.id = coverage."batch_id"
			order by batch."last_ledger"
		`);
	}

	async operationResultRows() {
		return this.dataSource.query<
			Array<{
				readonly batchId: string;
				readonly factScope: string;
				readonly operationResultCode: number | null;
				readonly operationSpecificResultCode: number | null;
				readonly outcome: string;
			}>
		>(`
			select operation."batch_id" as "batchId", result."outcome",
				result."operation_result_code" as "operationResultCode",
				result."operation_specific_result_code"
					as "operationSpecificResultCode",
				result."fact_scope" as "factScope"
			from "full_history_operation_result" result
			join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					result."network_passphrase_hash"
				and operation."transaction_hash" = result."transaction_hash"
				and operation."operation_index" = result."operation_index"
			join "full_history_ingestion_batch" batch
				on batch.id = operation."batch_id"
			order by batch."last_ledger"
		`);
	}

	async operationAccountReferenceCounts() {
		return this.dataSource.query<
			Array<{ readonly batchId: string; readonly count: number }>
		>(`
			select operation."batch_id" as "batchId",
				count(*)::integer as count
			from "full_history_operation_account_reference" reference
			join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					reference."network_passphrase_hash"
				and operation."transaction_hash" = reference."transaction_hash"
				and operation."operation_index" = reference."operation_index"
			join "full_history_ingestion_batch" batch
				on batch.id = operation."batch_id"
			group by operation."batch_id", batch."last_ledger"
			order by batch."last_ledger"
		`);
	}

	async operationAccountReferenceCoverageRows() {
		return this.dataSource.query<
			Array<{
				readonly accountReferenceCount: number;
				readonly batchId: string;
				readonly operationCount: number;
				readonly referenceDecoderVersion: string;
			}>
		>(`
			select coverage."account_reference_count" as "accountReferenceCount",
				coverage."batch_id" as "batchId",
				coverage."operation_count" as "operationCount",
				coverage."reference_decoder_version" as
					"referenceDecoderVersion"
			from "full_history_operation_account_reference_batch_coverage" coverage
			join "full_history_ingestion_batch" batch
				on batch.id = coverage."batch_id"
			order by batch."last_ledger"
		`);
	}

	async operationResultCoverageRows() {
		return this.dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationCount: number;
				readonly resultDecoderVersion: string;
			}>
		>(`
			select coverage."batch_id" as "batchId",
				coverage."operation_count" as "operationCount",
				coverage."result_decoder_version" as "resultDecoderVersion"
			from "full_history_operation_result_batch_coverage" coverage
			join "full_history_ingestion_batch" batch
				on batch.id = coverage."batch_id"
			order by batch."last_ledger"
		`);
	}
}
