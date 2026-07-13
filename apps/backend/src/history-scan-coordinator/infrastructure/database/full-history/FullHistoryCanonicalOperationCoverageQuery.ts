import type { DataSource } from 'typeorm';
import type { FullHistoryOperationCoverage } from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface FullHistoryOperationCoverageRow {
	readonly accountReferenceIndexedBatches: string;
	readonly canonicalBatches: string;
	readonly firstAccountReferenceIndexedLedger: string | null;
	readonly firstIndexedLedger: string | null;
	readonly firstOutcomeIndexedLedger: string | null;
	readonly indexedBatches: string;
	readonly lastAccountReferenceIndexedLedger: string | null;
	readonly lastIndexedLedger: string | null;
	readonly lastOutcomeIndexedLedger: string | null;
	readonly outcomeIndexedBatches: string;
}

export async function getCanonicalOperationCoverage(
	dataSource: DataSource,
	networkHash: FullHistoryHash
): Promise<FullHistoryOperationCoverage> {
	const rows = await dataSource.query<FullHistoryOperationCoverageRow[]>(
		`
			select count(batch.id)::text as "canonicalBatches",
				count(coverage."batch_id")::text as "indexedBatches",
				count(reference_coverage."batch_id")::text as
					"accountReferenceIndexedBatches",
				count(result_coverage."batch_id")::text as "outcomeIndexedBatches",
				min(coverage."first_ledger")::text as "firstIndexedLedger",
				max(coverage."last_ledger")::text as "lastIndexedLedger",
				min(reference_coverage."first_ledger")::text as
					"firstAccountReferenceIndexedLedger",
				max(reference_coverage."last_ledger")::text as
					"lastAccountReferenceIndexedLedger",
				min(result_coverage."first_ledger")::text as
					"firstOutcomeIndexedLedger",
				max(result_coverage."last_ledger")::text as
					"lastOutcomeIndexedLedger"
			from "full_history_ingestion_batch" batch
			left join "full_history_operation_batch_coverage" coverage
				on coverage."batch_id" = batch.id
				and coverage."network_passphrase_hash" =
					batch."network_passphrase_hash"
			left join
				"full_history_operation_account_reference_batch_coverage"
					reference_coverage
				on reference_coverage."batch_id" = batch.id
				and reference_coverage."network_passphrase_hash" =
					batch."network_passphrase_hash"
			left join "full_history_operation_result_batch_coverage" result_coverage
				on result_coverage."batch_id" = batch.id
				and result_coverage."network_passphrase_hash" =
					batch."network_passphrase_hash"
			where batch."network_passphrase_hash" = $1
		`,
		[networkHash.toBuffer()]
	);
	const row = rows[0];
	if (row === undefined) {
		throw new Error('PostgreSQL did not return operation coverage');
	}
	const canonicalBatches = readCount(row.canonicalBatches, 'canonicalBatches');
	const indexedBatches = readCount(row.indexedBatches, 'indexedBatches');
	const accountReferenceIndexedBatches = readCount(
		row.accountReferenceIndexedBatches,
		'accountReferenceIndexedBatches'
	);
	const outcomeIndexedBatches = readCount(
		row.outcomeIndexedBatches,
		'outcomeIndexedBatches'
	);
	const operationFactsComplete =
		canonicalBatches > 0 && indexedBatches === canonicalBatches;
	const accountReferencesComplete =
		canonicalBatches > 0 && accountReferenceIndexedBatches === canonicalBatches;
	return {
		accountReferenceIndexedBatches,
		accountReferencesComplete,
		canonicalBatches,
		complete: operationFactsComplete && accountReferencesComplete,
		firstAccountReferenceIndexedLedger: readOptionalLedger(
			row.firstAccountReferenceIndexedLedger,
			'firstAccountReferenceIndexedLedger'
		),
		firstIndexedLedger: readOptionalLedger(
			row.firstIndexedLedger,
			'firstIndexedLedger'
		),
		firstOutcomeIndexedLedger: readOptionalLedger(
			row.firstOutcomeIndexedLedger,
			'firstOutcomeIndexedLedger'
		),
		indexedBatches,
		lastAccountReferenceIndexedLedger: readOptionalLedger(
			row.lastAccountReferenceIndexedLedger,
			'lastAccountReferenceIndexedLedger'
		),
		lastIndexedLedger: readOptionalLedger(
			row.lastIndexedLedger,
			'lastIndexedLedger'
		),
		lastOutcomeIndexedLedger: readOptionalLedger(
			row.lastOutcomeIndexedLedger,
			'lastOutcomeIndexedLedger'
		),
		outcomeIndexedBatches,
		operationFactsComplete,
		outcomesComplete:
			canonicalBatches > 0 && outcomeIndexedBatches === canonicalBatches
	};
}

function readCount(value: string, field: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TypeError(`PostgreSQL returned an invalid ${field}`);
	}
	return count;
}

function readOptionalLedger(
	value: string | null,
	field: string
): ReturnType<typeof fullHistoryLedgerSequence> | null {
	return value === null ? null : fullHistoryLedgerSequence(value, field);
}
