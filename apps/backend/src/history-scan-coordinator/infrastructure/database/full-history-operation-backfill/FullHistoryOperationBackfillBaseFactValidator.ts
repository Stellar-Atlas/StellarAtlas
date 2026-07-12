import type { EntityManager } from 'typeorm';
import type {
	FullHistoryCheckpointWrite,
	FullHistoryLedgerInput,
	FullHistoryTransactionInput,
	FullHistoryTransactionResultInput
} from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import { FullHistoryHash } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface LedgerRow {
	readonly bucketListHash: Buffer;
	readonly closedAt: Date;
	readonly ledgerHash: Buffer;
	readonly ledgerSequence: string;
	readonly previousLedgerHash: Buffer;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultHash: Buffer;
	readonly transactionSetHash: Buffer;
}

interface TransactionRow {
	readonly envelopeType: string;
	readonly feeBid: string;
	readonly ledgerSequence: string;
	readonly operationCount: number;
	readonly sourceAccount: string;
	readonly sourceAccountSequence: string;
	readonly transactionHash: Buffer;
	readonly transactionIndex: number;
}

interface ResultRow {
	readonly feeCharged: string;
	readonly ledgerSequence: string;
	readonly operationResultCount: number;
	readonly resultCode: number;
	readonly successful: boolean;
	readonly transactionHash: Buffer;
	readonly transactionIndex: number;
}

const ledgerFactsSql = `
	select "ledger_sequence"::text as "ledgerSequence",
		"ledger_hash" as "ledgerHash",
		"previous_ledger_hash" as "previousLedgerHash",
		"transaction_set_hash" as "transactionSetHash",
		"transaction_result_hash" as "transactionResultHash",
		"bucket_list_hash" as "bucketListHash",
		"protocol_version" as "protocolVersion", "closed_at" as "closedAt",
		"transaction_count" as "transactionCount"
	from "full_history_ledger"
	where "batch_id" = $1 and "network_passphrase_hash" = $2
		and "ledger_sequence" between $3 and $4
	order by "ledger_sequence"
`;

const transactionFactsSql = `
	select "transaction_hash" as "transactionHash",
		"ledger_sequence"::text as "ledgerSequence",
		"transaction_index" as "transactionIndex",
		"envelope_type" as "envelopeType", "source_account" as "sourceAccount",
		"source_account_sequence"::text as "sourceAccountSequence",
		"fee_bid"::text as "feeBid", "operation_count" as "operationCount"
	from "full_history_transaction"
	where "batch_id" = $1 and "network_passphrase_hash" = $2
		and "ledger_sequence" between $3 and $4
	order by "ledger_sequence", "transaction_index"
`;

export const FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL = `
	select "transaction_hash" as "transactionHash",
		"ledger_sequence"::text as "ledgerSequence",
		"transaction_index" as "transactionIndex",
		"fee_charged"::text as "feeCharged", "successful",
		"result_code" as "resultCode",
		"operation_result_count" as "operationResultCount"
	from "full_history_transaction_result"
	where "batch_id" = $1 and "network_passphrase_hash" = $2
		and "ledger_sequence" between $3 and $4
	order by "ledger_sequence", "transaction_index", "transaction_hash"
`;

export async function assertOperationBackfillBaseFacts(
	manager: Pick<EntityManager, 'query'>,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	const parameters = [
		input.batchId,
		networkHash.toBuffer(),
		input.firstLedger,
		input.lastLedger
	];
	const ledgers = await manager.query<LedgerRow[]>(ledgerFactsSql, parameters);
	const transactions = await manager.query<TransactionRow[]>(
		transactionFactsSql,
		parameters
	);
	const results = await manager.query<ResultRow[]>(
		FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL,
		parameters
	);
	if (
		!ledgersMatch(ledgers, input.ledgers) ||
		!transactionsMatch(transactions, input.transactions) ||
		!resultsMatch(results, input.results)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical rows differ from the immutable operation-backfill batch'
		);
	}
}

function ledgersMatch(
	rows: readonly LedgerRow[],
	expected: readonly FullHistoryLedgerInput[]
): boolean {
	return (
		rows.length === expected.length &&
		rows.every((row, index) => {
			const ledger = expected[index];
			return (
				ledger !== undefined &&
				row.ledgerSequence === ledger.ledgerSequence &&
				FullHistoryHash.fromBytes(row.ledgerHash).equals(ledger.ledgerHash) &&
				FullHistoryHash.fromBytes(row.previousLedgerHash).equals(
					ledger.previousLedgerHash
				) &&
				FullHistoryHash.fromBytes(row.transactionSetHash).equals(
					ledger.transactionSetHash
				) &&
				FullHistoryHash.fromBytes(row.transactionResultHash).equals(
					ledger.transactionResultHash
				) &&
				FullHistoryHash.fromBytes(row.bucketListHash).equals(
					ledger.bucketListHash
				) &&
				row.protocolVersion === ledger.protocolVersion &&
				new Date(row.closedAt).getTime() === ledger.closedAt.getTime() &&
				row.transactionCount === ledger.transactionCount
			);
		})
	);
}

function transactionsMatch(
	rows: readonly TransactionRow[],
	expected: readonly FullHistoryTransactionInput[]
): boolean {
	const byHash = new Map(
		expected.map((transaction) => [
			transaction.transactionHash.toHex(),
			transaction
		])
	);
	return (
		rows.length === expected.length &&
		rows.every((row) => {
			const transaction = byHash.get(row.transactionHash.toString('hex'));
			return (
				transaction !== undefined &&
				row.ledgerSequence === transaction.ledgerSequence &&
				row.transactionIndex === transaction.transactionIndex &&
				row.envelopeType === transaction.envelopeType &&
				row.sourceAccount === transaction.sourceAccount &&
				row.sourceAccountSequence === transaction.sourceAccountSequence &&
				row.feeBid === transaction.feeBid &&
				row.operationCount === transaction.operationCount
			);
		})
	);
}

function resultsMatch(
	rows: readonly ResultRow[],
	expected: readonly FullHistoryTransactionResultInput[]
): boolean {
	const byHash = new Map(
		expected.map((result) => [result.transactionHash.toHex(), result])
	);
	return (
		rows.length === expected.length &&
		rows.every((row) => {
			const result = byHash.get(row.transactionHash.toString('hex'));
			return (
				result !== undefined &&
				row.ledgerSequence === result.ledgerSequence &&
				row.transactionIndex === result.transactionIndex &&
				row.feeCharged === result.feeCharged &&
				row.successful === result.successful &&
				row.resultCode === result.resultCode &&
				row.operationResultCount === result.operationResultCount
			);
		})
	);
}
