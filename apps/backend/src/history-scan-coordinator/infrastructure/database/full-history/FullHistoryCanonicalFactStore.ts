import type { EntityManager } from 'typeorm';
import type {
	FullHistoryCheckpointWrite,
	FullHistoryLedgerInput,
	FullHistoryTransactionInput,
	FullHistoryTransactionResultInput
} from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import { FullHistoryHash } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	buildFullHistorySqlValues,
	chunkFullHistoryValues
} from './FullHistorySqlValues.js';

const transactionChunkSize = 500;

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

export async function storeCanonicalFacts(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	await storeCanonicalBaseFacts(manager, input, networkHash);
}

export async function storeCanonicalBaseFacts(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	await insertLedgers(manager, input, networkHash);
	for (const chunk of chunkFullHistoryValues(
		input.transactions,
		transactionChunkSize
	)) {
		await insertTransactions(manager, input.batchId, networkHash, chunk);
	}
	for (const chunk of chunkFullHistoryValues(
		input.results,
		transactionChunkSize
	)) {
		await insertResults(manager, input.batchId, networkHash, chunk);
	}
	await assertCanonicalBaseFacts(manager, input, networkHash);
}

export async function assertCanonicalFacts(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	await assertCanonicalBaseFacts(manager, input, networkHash);
}

export async function assertCanonicalBaseFacts(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	const ledgers = await readLedgers(manager, input.batchId);
	const transactions = await readTransactions(manager, input.batchId);
	const results = await readResults(manager, input.batchId);
	if (
		!ledgersMatch(ledgers, input.ledgers) ||
		!transactionsMatch(transactions, input.transactions) ||
		!resultsMatch(results, input.results)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical rows differ from the immutable checkpoint batch'
		);
	}
	const wrongNetworkRows = (await manager.query(
		`
			select count(*)::integer as count
			from "full_history_ledger"
			where "batch_id" = $1 and "network_passphrase_hash" <> $2
		`,
		[input.batchId, networkHash.toBuffer()]
	)) as Array<{ readonly count: number }>;
	if ((wrongNetworkRows[0]?.count ?? 0) !== 0) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical rows carry a different network identity'
		);
	}
}

async function insertLedgers(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	const values = input.ledgers.map((ledger) => [
		networkHash.toBuffer(),
		ledger.ledgerSequence,
		input.batchId,
		ledger.ledgerHash.toBuffer(),
		ledger.previousLedgerHash.toBuffer(),
		ledger.transactionSetHash.toBuffer(),
		ledger.transactionResultHash.toBuffer(),
		ledger.bucketListHash.toBuffer(),
		ledger.protocolVersion,
		ledger.closedAt,
		ledger.transactionCount
	]);
	const insert = buildFullHistorySqlValues(values);
	await manager.query(
		`
			insert into "full_history_ledger" (
				"network_passphrase_hash", "ledger_sequence", "batch_id",
				"ledger_hash", "previous_ledger_hash", "transaction_set_hash",
				"transaction_result_hash", "bucket_list_hash", "protocol_version",
				"closed_at", "transaction_count"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function insertTransactions(
	manager: EntityManager,
	batchId: string,
	networkHash: FullHistoryHash,
	transactions: readonly FullHistoryTransactionInput[]
): Promise<void> {
	if (transactions.length === 0) return;
	const insert = buildFullHistorySqlValues(
		transactions.map((transaction) => [
			networkHash.toBuffer(),
			transaction.transactionHash.toBuffer(),
			batchId,
			transaction.ledgerSequence,
			transaction.transactionIndex,
			transaction.envelopeType,
			transaction.sourceAccount,
			transaction.sourceAccountSequence,
			transaction.feeBid,
			transaction.operationCount
		])
	);
	await manager.query(
		`
			insert into "full_history_transaction" (
				"network_passphrase_hash", "transaction_hash", "batch_id",
				"ledger_sequence", "transaction_index", "envelope_type",
				"source_account", "source_account_sequence", "fee_bid",
				"operation_count"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function insertResults(
	manager: EntityManager,
	batchId: string,
	networkHash: FullHistoryHash,
	results: readonly FullHistoryTransactionResultInput[]
): Promise<void> {
	if (results.length === 0) return;
	const insert = buildFullHistorySqlValues(
		results.map((result) => [
			networkHash.toBuffer(),
			result.transactionHash.toBuffer(),
			result.ledgerSequence,
			result.transactionIndex,
			batchId,
			result.feeCharged,
			result.successful,
			result.resultCode,
			result.operationResultCount
		])
	);
	await manager.query(
		`
			insert into "full_history_transaction_result" (
				"network_passphrase_hash", "transaction_hash", "ledger_sequence",
				"transaction_index", "batch_id",
				"fee_charged", "successful", "result_code",
				"operation_result_count"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function readLedgers(
	manager: EntityManager,
	batchId: string
): Promise<LedgerRow[]> {
	return manager.query(
		`
			select "ledger_sequence" as "ledgerSequence", "ledger_hash" as "ledgerHash",
				"previous_ledger_hash" as "previousLedgerHash",
				"transaction_set_hash" as "transactionSetHash",
				"transaction_result_hash" as "transactionResultHash",
				"bucket_list_hash" as "bucketListHash",
				"protocol_version" as "protocolVersion", "closed_at" as "closedAt",
				"transaction_count" as "transactionCount"
			from "full_history_ledger" where "batch_id" = $1
			order by "ledger_sequence"
		`,
		[batchId]
	);
}

async function readTransactions(
	manager: EntityManager,
	batchId: string
): Promise<TransactionRow[]> {
	return manager.query(
		`
			select "transaction_hash" as "transactionHash",
				"ledger_sequence" as "ledgerSequence",
				"transaction_index" as "transactionIndex",
				"envelope_type" as "envelopeType", "source_account" as "sourceAccount",
				"source_account_sequence" as "sourceAccountSequence",
				"fee_bid" as "feeBid", "operation_count" as "operationCount"
			from "full_history_transaction" where "batch_id" = $1
			order by "ledger_sequence", "transaction_index"
		`,
		[batchId]
	);
}

async function readResults(
	manager: EntityManager,
	batchId: string
): Promise<ResultRow[]> {
	return manager.query(
		`
			select "transaction_hash" as "transactionHash",
				"ledger_sequence" as "ledgerSequence",
				"transaction_index" as "transactionIndex",
				"fee_charged" as "feeCharged", "successful",
				"result_code" as "resultCode",
				"operation_result_count" as "operationResultCount"
			from "full_history_transaction_result" where "batch_id" = $1
			order by "ledger_sequence", "transaction_index", "transaction_hash"
		`,
		[batchId]
	);
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
		expected.map((row) => [row.transactionHash.toHex(), row])
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
		expected.map((row) => [row.transactionHash.toHex(), row])
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
