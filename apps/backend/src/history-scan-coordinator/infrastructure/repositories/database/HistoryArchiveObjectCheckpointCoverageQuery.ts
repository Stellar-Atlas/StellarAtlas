import type { EntityManager } from 'typeorm';
import type { HistoryArchiveCheckpointCoverageV1 } from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type CheckpointCoverageRow = {
	readonly activeArchiveCheckpoints?: NumericValue;
	readonly activearchivecheckpoints?: NumericValue;
	readonly archiveRootsWithState?: NumericValue;
	readonly archiverootswithstate?: NumericValue;
	readonly categoryConsistencyFailedCheckpoints?: NumericValue;
	readonly categoryconsistencyfailedcheckpoints?: NumericValue;
	readonly categoryConsistencyNotEvaluatedCheckpoints?: NumericValue;
	readonly categoryconsistencynotevaluatedcheckpoints?: NumericValue;
	readonly categoryConsistencyPendingCheckpoints?: NumericValue;
	readonly categoryconsistencypendingcheckpoints?: NumericValue;
	readonly categoryConsistentArchiveCheckpoints?: NumericValue;
	readonly categoryconsistentarchivecheckpoints?: NumericValue;
	readonly completeArchiveCheckpoints?: NumericValue;
	readonly completearchivecheckpoints?: NumericValue;
	readonly discoveryCompleteArchiveRoots?: NumericValue;
	readonly discoverycompletearchiveroots?: NumericValue;
	readonly expectedArchiveCheckpoints?: NumericValue;
	readonly expectedarchivecheckpoints?: NumericValue;
	readonly failedArchiveCheckpoints?: NumericValue;
	readonly failedarchivecheckpoints?: NumericValue;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly missingArchiveCheckpoints?: NumericValue;
	readonly missingarchivecheckpoints?: NumericValue;
	readonly objectCompleteArchiveCheckpoints?: NumericValue;
	readonly objectcompletearchivecheckpoints?: NumericValue;
	readonly oldestCheckpointLedger?: NumericValue | null;
	readonly oldestcheckpointledger?: NumericValue | null;
	readonly partialArchiveCheckpoints?: NumericValue;
	readonly partialarchivecheckpoints?: NumericValue;
	readonly totalArchiveCheckpoints?: NumericValue;
	readonly totalarchivecheckpoints?: NumericValue;
};

export async function getCheckpointCoverage(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<HistoryArchiveCheckpointCoverageV1> {
	const [row] = (await manager.query(checkpointCoverageSql, [
		archiveUrlIdentity
	])) as readonly CheckpointCoverageRow[];

	return {
		activeArchiveCheckpoints: numberField(row, 'activeArchiveCheckpoints'),
		archiveRootsWithState: numberField(row, 'archiveRootsWithState'),
		categoryConsistencyFailedCheckpoints: numberField(
			row,
			'categoryConsistencyFailedCheckpoints'
		),
		categoryConsistencyNotEvaluatedCheckpoints: numberField(
			row,
			'categoryConsistencyNotEvaluatedCheckpoints'
		),
		categoryConsistencyPendingCheckpoints: numberField(
			row,
			'categoryConsistencyPendingCheckpoints'
		),
		categoryConsistentArchiveCheckpoints: numberField(
			row,
			'categoryConsistentArchiveCheckpoints'
		),
		completeArchiveCheckpoints: numberField(row, 'completeArchiveCheckpoints'),
		discoveryCompleteArchiveRoots: numberField(
			row,
			'discoveryCompleteArchiveRoots'
		),
		expectedArchiveCheckpoints: numberField(row, 'expectedArchiveCheckpoints'),
		failedArchiveCheckpoints: numberField(row, 'failedArchiveCheckpoints'),
		latestCheckpointLedger: nullableNumberField(row, 'latestCheckpointLedger'),
		missingArchiveCheckpoints: numberField(row, 'missingArchiveCheckpoints'),
		objectCompleteArchiveCheckpoints: numberField(
			row,
			'objectCompleteArchiveCheckpoints'
		),
		oldestCheckpointLedger: nullableNumberField(row, 'oldestCheckpointLedger'),
		partialArchiveCheckpoints: numberField(row, 'partialArchiveCheckpoints'),
		totalArchiveCheckpoints: numberField(row, 'totalArchiveCheckpoints')
	};
}

function numberField(
	row: CheckpointCoverageRow | undefined,
	field: keyof CheckpointCoverageRow
): number {
	return requireNumber(
		row?.[field] ?? row?.[lowercase(field)] ?? undefined,
		field
	);
}

function nullableNumberField(
	row: CheckpointCoverageRow | undefined,
	field: keyof CheckpointCoverageRow
): number | null {
	const value = row?.[field] ?? row?.[lowercase(field)];
	if (value === null || value === undefined) return null;
	return requireNumber(value, field);
}

function lowercase(
	field: keyof CheckpointCoverageRow
): keyof CheckpointCoverageRow {
	return field.toLowerCase() as keyof CheckpointCoverageRow;
}

const archiveFilterSql =
	'($1::text is null or "archiveUrlIdentity" = $1::text)';

const categoryLedgersJsonSql = `
	coalesce(
		"verificationFacts"->'ledgerCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const transactionsLedgersJsonSql = `
	coalesce(
		"verificationFacts"->'transactionsCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const resultsLedgersJsonSql = `
	coalesce(
		"verificationFacts"->'resultsCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const checkpointCoverageSql = `
	with root_state as (
		select
			"archiveUrlIdentity",
			floor((greatest("currentLedger", 63) + 1)::numeric / 64)::integer
				as "expectedCheckpointCount"
		from history_archive_state_snapshot
		where ${archiveFilterSql}
			and status = 'available'
			and "currentLedger" is not null
			and "currentLedger" >= 0
	),
	checkpoint_rollup as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			bool_or(status = 'failed') as has_failed,
			bool_or(status = 'scanning') as has_active,
			bool_or("objectType" = 'scp') as expects_scp,
			bool_or("objectType" = 'checkpoint-state' and status = 'verified')
				as has_checkpoint_state,
			bool_or("objectType" = 'ledger' and status = 'verified') as has_ledger,
			bool_or("objectType" = 'transactions' and status = 'verified')
				as has_transactions,
			bool_or("objectType" = 'results' and status = 'verified') as has_results,
			bool_or("objectType" = 'scp' and status = 'verified') as has_scp
		from history_archive_object_queue
		where ${archiveFilterSql}
			and "checkpointLedger" is not null
		group by "archiveUrlIdentity", "checkpointLedger"
	),
	root_coverage as (
		select
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount",
			count(distinct checkpoint_rollup."checkpointLedger")
				as "scheduledCheckpointCount",
			min(checkpoint_rollup."checkpointLedger") as "oldestCheckpointLedger"
		from root_state
		left join checkpoint_rollup
			on checkpoint_rollup."archiveUrlIdentity" = root_state."archiveUrlIdentity"
		group by
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount"
	),
	state_facts as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			"verificationFacts"#>>'{checkpointHistoryArchiveStateFact,bucketListHash}'
				as bucket_list_hash
		from history_archive_object_queue
		where ${archiveFilterSql}
			and "objectType" = 'checkpoint-state'
			and status = 'verified'
			and "checkpointLedger" is not null
	),
	ledger_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'ledgerHeaderHash' as ledger_header_hash,
			fact->>'previousLedgerHeaderHash' as previous_ledger_header_hash,
			fact->>'transactionSetHash' as transaction_set_hash,
			fact->>'transactionResultSetHash' as transaction_result_hash,
			fact->>'bucketListHash' as bucket_list_hash
		from history_archive_object_queue object
		cross join lateral jsonb_array_elements(${categoryLedgersJsonSql}) fact
		where ${archiveFilterSql}
			and object."objectType" = 'ledger'
			and object.status = 'verified'
			and object."checkpointLedger" is not null
	),
	ledger_chain as (
		select
			ledger_facts.*,
			lag(ledger_header_hash) over (
				partition by "archiveUrlIdentity", "checkpointLedger"
				order by ledger
			) as previous_fact_hash,
			min(ledger) over (
				partition by "archiveUrlIdentity", "checkpointLedger"
			) as first_ledger
		from ledger_facts
	),
	transaction_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'hash' as hash
		from history_archive_object_queue object
		cross join lateral jsonb_array_elements(${transactionsLedgersJsonSql}) fact
		where ${archiveFilterSql}
			and object."objectType" = 'transactions'
			and object.status = 'verified'
			and object."checkpointLedger" is not null
	),
	result_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'hash' as hash
		from history_archive_object_queue object
		cross join lateral jsonb_array_elements(${resultsLedgersJsonSql}) fact
		where ${archiveFilterSql}
			and object."objectType" = 'results'
			and object.status = 'verified'
			and object."checkpointLedger" is not null
	),
	proof_rollup as (
		select
			ledger_chain."archiveUrlIdentity",
			ledger_chain."checkpointLedger",
			count(*) as ledger_fact_count,
			count(transaction_facts.hash) as transaction_fact_count,
			count(result_facts.hash) as result_fact_count,
			bool_or(
				ledger_chain.ledger = ledger_chain."checkpointLedger"
				and ledger_chain.bucket_list_hash = state_facts.bucket_list_hash
			) as checkpoint_bucket_matches,
			bool_or(state_facts.bucket_list_hash is not null)
				as has_checkpoint_bucket_fact,
			bool_and(coalesce(
				ledger_chain.transaction_set_hash = transaction_facts.hash,
				false
			)) as transactions_match,
			bool_and(coalesce(
				ledger_chain.transaction_result_hash = result_facts.hash,
				false
			)) as results_match,
			bool_and(
				ledger_chain.ledger = ledger_chain.first_ledger
				or coalesce(
					ledger_chain.previous_ledger_header_hash =
						ledger_chain.previous_fact_hash,
					false
				)
			) as previous_ledgers_match
		from ledger_chain
		left join transaction_facts
			on transaction_facts."archiveUrlIdentity" =
				ledger_chain."archiveUrlIdentity"
			and transaction_facts."checkpointLedger" =
				ledger_chain."checkpointLedger"
			and transaction_facts.ledger = ledger_chain.ledger
		left join result_facts
			on result_facts."archiveUrlIdentity" = ledger_chain."archiveUrlIdentity"
			and result_facts."checkpointLedger" = ledger_chain."checkpointLedger"
			and result_facts.ledger = ledger_chain.ledger
		left join state_facts
			on state_facts."archiveUrlIdentity" = ledger_chain."archiveUrlIdentity"
			and state_facts."checkpointLedger" = ledger_chain."checkpointLedger"
		group by ledger_chain."archiveUrlIdentity", ledger_chain."checkpointLedger"
	),
	materialized_proof as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			status
		from history_archive_checkpoint_proof
		where ${archiveFilterSql}
	),
	classified as (
		select
			checkpoint_rollup."checkpointLedger",
			checkpoint_rollup.has_failed,
			checkpoint_rollup.has_active,
			materialized_proof.status as materialized_status,
			(
				not checkpoint_rollup.has_failed
				and checkpoint_rollup.has_checkpoint_state
				and checkpoint_rollup.has_ledger
				and checkpoint_rollup.has_transactions
				and checkpoint_rollup.has_results
				and (not checkpoint_rollup.expects_scp or checkpoint_rollup.has_scp)
			) as is_object_complete,
			(
				proof_rollup.ledger_fact_count > 0
				and proof_rollup.transaction_fact_count =
					proof_rollup.ledger_fact_count
				and proof_rollup.result_fact_count = proof_rollup.ledger_fact_count
				and proof_rollup.has_checkpoint_bucket_fact
			) as has_complete_proof_facts,
			(
				proof_rollup.checkpoint_bucket_matches
				and proof_rollup.transactions_match
				and proof_rollup.results_match
				and proof_rollup.previous_ledgers_match
			) as proof_matches
		from checkpoint_rollup
		left join proof_rollup
			on proof_rollup."archiveUrlIdentity" =
				checkpoint_rollup."archiveUrlIdentity"
			and proof_rollup."checkpointLedger" =
				checkpoint_rollup."checkpointLedger"
		left join materialized_proof
			on materialized_proof."archiveUrlIdentity" =
				checkpoint_rollup."archiveUrlIdentity"
			and materialized_proof."checkpointLedger" =
				checkpoint_rollup."checkpointLedger"
	),
	proof_classified as (
		select
			*,
			case
				when materialized_status is not null
					then materialized_status = 'verified'
				else is_object_complete
					and has_complete_proof_facts
					and proof_matches
			end as is_category_consistent,
			case
				when materialized_status is not null
					then materialized_status = 'mismatch'
				else is_object_complete
					and has_complete_proof_facts
					and not proof_matches
			end as is_category_failed,
			case
				when materialized_status is not null
					then materialized_status = 'not-evaluable' and not has_failed
				else is_object_complete
					and not coalesce(has_complete_proof_facts, false)
			end as is_category_not_evaluated
		from classified
	)
	select
		count(*) as "totalArchiveCheckpoints",
		count(*) filter (where has_active) as "activeArchiveCheckpoints",
		count(*) filter (where has_failed) as "failedArchiveCheckpoints",
		count(*) filter (where is_object_complete)
			as "completeArchiveCheckpoints",
		count(*) filter (where is_object_complete)
			as "objectCompleteArchiveCheckpoints",
		count(*) filter (where is_category_consistent)
			as "categoryConsistentArchiveCheckpoints",
		count(*) filter (where is_category_failed)
			as "categoryConsistencyFailedCheckpoints",
		count(*) filter (where is_category_not_evaluated)
			as "categoryConsistencyNotEvaluatedCheckpoints",
		count(*) filter (where not is_object_complete and not has_failed)
			as "categoryConsistencyPendingCheckpoints",
		count(*) filter (where not is_object_complete and not has_failed)
			as "partialArchiveCheckpoints",
		min("checkpointLedger") as "oldestCheckpointLedger",
		max("checkpointLedger") as "latestCheckpointLedger",
		coalesce((select count(*) from root_coverage), 0)
			as "archiveRootsWithState",
		coalesce(
			(select sum("expectedCheckpointCount") from root_coverage),
			0
		) as "expectedArchiveCheckpoints",
		coalesce(
			(
				select sum(
					greatest(
						"expectedCheckpointCount" - "scheduledCheckpointCount",
						0
					)
				)
				from root_coverage
			),
			0
		) as "missingArchiveCheckpoints",
		coalesce(
			(
				select count(*)
				from root_coverage
				where "expectedCheckpointCount" > 0
					and "scheduledCheckpointCount" >= "expectedCheckpointCount"
					and "oldestCheckpointLedger" <= 63
			),
			0
		) as "discoveryCompleteArchiveRoots"
	from proof_classified
`;
