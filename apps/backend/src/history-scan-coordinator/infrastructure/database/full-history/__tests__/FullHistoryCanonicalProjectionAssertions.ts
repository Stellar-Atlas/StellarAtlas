import type { DataSource } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';

export interface FullHistoryCanonicalProjectionCounts {
	readonly accountReferenceCoverage: number;
	readonly accountReferences: number;
	readonly operationCoverage: number;
	readonly operationResultCoverage: number;
	readonly operationResults: number;
	readonly operations: number;
}

export const emptyFullHistoryCanonicalProjectionCounts: FullHistoryCanonicalProjectionCounts =
	{
		accountReferenceCoverage: 0,
		accountReferences: 0,
		operationCoverage: 0,
		operationResultCoverage: 0,
		operationResults: 0,
		operations: 0
	};

export function expectedFullHistoryCanonicalProjectionCounts(
	input: FullHistoryCheckpointWrite
): FullHistoryCanonicalProjectionCounts {
	return {
		accountReferenceCoverage: 1,
		accountReferences: input.operationAccountReferences.length,
		operationCoverage: 1,
		operationResultCoverage: 1,
		operationResults: input.operationResults.length,
		operations: input.operations.length
	};
}

export async function fullHistoryCanonicalProjectionCounts(
	dataSource: DataSource,
	batchId: string
): Promise<FullHistoryCanonicalProjectionCounts> {
	const rows = await dataSource.query<FullHistoryCanonicalProjectionCounts[]>(
		`select
			(select count(*)::integer from "full_history_operation"
			 where "batch_id" = $1) as operations,
			(select count(*)::integer from "full_history_operation_batch_coverage"
			 where "batch_id" = $1) as "operationCoverage",
			(select count(*)::integer
			 from "full_history_operation_account_reference" reference
			 join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					reference."network_passphrase_hash"
				and operation."transaction_hash" = reference."transaction_hash"
				and operation."operation_index" = reference."operation_index"
			 where operation."batch_id" = $1) as "accountReferences",
			(select count(*)::integer
			 from "full_history_operation_account_reference_batch_coverage"
			 where "batch_id" = $1) as "accountReferenceCoverage",
			(select count(*)::integer from "full_history_operation_result" result
			 join "full_history_operation" operation
				on operation."network_passphrase_hash" = result."network_passphrase_hash"
				and operation."transaction_hash" = result."transaction_hash"
				and operation."operation_index" = result."operation_index"
			 where operation."batch_id" = $1) as "operationResults",
			(select count(*)::integer
			 from "full_history_operation_result_batch_coverage"
			 where "batch_id" = $1) as "operationResultCoverage"`,
		[batchId]
	);
	const counts = rows[0];
	if (counts === undefined)
		throw new Error('Missing canonical projection counts');
	return counts;
}
