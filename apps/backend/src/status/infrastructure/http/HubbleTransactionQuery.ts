import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import { classifyHubbleEventRows } from './HubbleEventRelationshipQuery.js';
import type {
	HubbleTransactionDetail,
	HubbleTransactionInput,
	HubbleTransactionPage,
	HubbleTransactionRecord,
	HubbleTransactionRelation
} from './HubbleTransactionContracts.js';
import {
	decodeTransactionCursor,
	encodeTransactionCursor,
	normalizeTransactionInput,
	type TransactionPosition
} from './HubbleTransactionCursor.js';
import { transactionEnvelopeOperations } from './HubbleTransactionEnvelope.js';
import {
	mapTransaction,
	mapTransactionEffect,
	mapTransactionEvent,
	mapTransactionOperation,
	transactionInteger,
	transactionNumber
} from './HubbleTransactionMapper.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

type Row = Record<string, unknown>;
const transactionColumns =
	'toString(id) AS record_id, transaction_hash, ledger_sequence, closed_at, account, account_muxed, toString(account_sequence) AS record_account_sequence, successful, operation_count, memo_type, memo, toString(fee_charged) AS record_fee_charged, toString(max_fee) AS record_max_fee, fee_account, transaction_result_code, tx_envelope';
const relationDefinitions = {
	operations: {
		table: 'history_operations',
		key: 'id',
		index: 'toUInt32(0)',
		columns:
			'toString(id) AS record_id, toString(transaction_id) AS record_transaction_id, ledger_sequence, closed_at, type, type_string, source_account, source_account_muxed, operation_result_code, operation_trace_code, details'
	},
	effects: {
		table: 'history_effects',
		key: 'operation_id',
		index: '`index`',
		columns:
			'id, toString(operation_id) AS record_operation_id, `index`, ledger_sequence, closed_at, type, type_string, address, address_muxed, details'
	},
	events: {
		table: 'history_contract_events',
		key: 'transaction_id',
		index: 'toUInt32(0)',
		columns:
			'toString(transaction_id) AS record_transaction_id, transaction_hash, toString(operation_id) AS record_operation_id, ledger_sequence, closed_at, contract_id, type, type_string, successful, in_successful_contract_call, topics_decoded, data_decoded, contract_event_xdr'
	}
} as const;
export async function queryHubbleTransactionDetail(
	executor: HubbleSemanticQueryExecutor,
	request: HubbleTransactionInput
): Promise<HubbleTransactionDetail | null> {
	const input = normalizeTransactionInput(request);
	if (input.limit! > executor.maximumRows)
		throw new HubbleWarehouseInputError(
			'Transaction page limit exceeds the configured warehouse maximum'
		);
	const parameters: HubblePreparedParameter[] = [
		{ name: 'hash', type: 'String', value: input.transactionHash }
	];
	const where = [
		'transaction_hash = {hash:String}',
		completedHubbleBatchPredicate(executor.database)
	];
	if (input.ledgerSequence !== undefined) {
		parameters.push({
			name: 'ledger',
			type: 'UInt32',
			value: String(input.ledgerSequence)
		});
		where.push(
			'ledger_sequence = {ledger:UInt32}',
			'_ledger_sequence = {ledger:UInt32}'
		);
	}
	// Hash-only lookup deliberately reuses the existing bloom index and server-managed budget.
	const result = await executor.execute<Row>(
		[
			'SELECT ' + transactionColumns,
			'FROM ' +
				quoteHubbleIdentifier(executor.database) +
				'.history_transactions',
			'WHERE ' + where.join(' AND '),
			'LIMIT 1 FORMAT JSON'
		].join('\n'),
		parameters
	);
	const rows = boundedRows(result.data, 1);
	if (!rows[0]) return null;
	const row = normalizeAliases(rows[0]);
	const transaction = mapTransaction(row);
	if (
		transaction.hash !== input.transactionHash ||
		(input.ledgerSequence !== undefined &&
			transaction.ledgerSequence !== input.ledgerSequence) ||
		transaction.operationCount > 100 ||
		BigInt(transaction.id) % 4096n !== 0n ||
		BigInt(transaction.id) >> 32n !== BigInt(transaction.ledgerSequence)
	)
		throw new HubbleWarehouseUnavailableError(
			'Transaction identity or operation count does not match its ledger'
		);
	const envelope =
		typeof row.tx_envelope === 'string'
			? transactionEnvelopeOperations(row.tx_envelope, transaction.hash)
			: null;
	const [operations, effects, events] = await Promise.all([
		relationPage(executor, transaction, input, 'operations'),
		relationPage(executor, transaction, input, 'effects'),
		relationPage(executor, transaction, input, 'events')
	]);
	const classified = await classifyHubbleEventRows(executor, events.items);
	return {
		transaction,
		operations: {
			...operations,
			items: operations.items.map((item) =>
				mapTransactionOperation(item, transaction, envelope)
			)
		},
		effects: { ...effects, items: effects.items.map(mapTransactionEffect) },
		events: { ...events, items: classified.map(mapTransactionEvent) },
		coverage: 'ingested-only',
		observedAt: new Date().toISOString()
	};
}
async function relationPage(
	executor: HubbleSemanticQueryExecutor,
	transaction: HubbleTransactionRecord,
	input: HubbleTransactionInput,
	relation: HubbleTransactionRelation
): Promise<HubbleTransactionPage<Row>> {
	const definition = relationDefinitions[relation];
	const limit = input.limit!;
	const scope = {
		hash: transaction.hash,
		ledger: transaction.ledgerSequence,
		transactionId: transaction.id,
		relation
	};
	const cursor = decodeTransactionCursor(
		input[
			(relation + 'After') as 'operationsAfter' | 'effectsAfter' | 'eventsAfter'
		],
		scope
	);
	if (
		cursor &&
		relation !== 'events' &&
		BigInt(cursor.key) >
			BigInt(transaction.id) + BigInt(transaction.operationCount)
	)
		throw new HubbleWarehouseInputError(
			'Transaction cursor exceeds the transaction operation range'
		);
	const parameters: HubblePreparedParameter[] = [
		{
			name: 'ledger',
			type: 'UInt32',
			value: String(transaction.ledgerSequence)
		},
		{ name: 'transaction', type: 'Int64', value: transaction.id },
		{ name: 'hash', type: 'String', value: transaction.hash },
		{
			name: 'last_operation',
			type: 'Int64',
			value: (
				BigInt(transaction.id) + BigInt(transaction.operationCount)
			).toString()
		},
		{ name: 'row_limit', type: 'UInt32', value: String(limit + 1) }
	];
	const where = [
		'ledger_sequence = {ledger:UInt32}',
		'_ledger_sequence = {ledger:UInt32}',
		completedHubbleBatchPredicate(executor.database),
		relation === 'effects'
			? 'operation_id > {transaction:Int64} AND operation_id <= {last_operation:Int64}'
			: 'transaction_id = {transaction:Int64}'
	];
	if (relation === 'events') where.push('transaction_hash = {hash:String}');
	const ordering =
		definition.key +
		', ' +
		definition.index +
		', _row_number, toString(_batch_id), toString(_source_sha256)';
	if (cursor) {
		parameters.push(
			{ name: 'after_key', type: 'Int64', value: cursor.key },
			{ name: 'after_index', type: 'UInt32', value: String(cursor.index) },
			{ name: 'after_row', type: 'UInt64', value: cursor.row },
			{ name: 'after_batch', type: 'String', value: cursor.batch },
			{ name: 'after_digest', type: 'String', value: cursor.digest }
		);
		where.push(
			'tuple(' +
				ordering +
				') > tuple({after_key:Int64}, {after_index:UInt32}, {after_row:UInt64}, {after_batch:String}, {after_digest:String})'
		);
	}
	const response = await executor.execute<Row>(
		[
			'SELECT ' +
				definition.columns +
				', toString(' +
				definition.key +
				') AS cursor_key, ' +
				definition.index +
				' AS cursor_index,',
			' toString(_row_number) AS cursor_row, toString(_batch_id) AS cursor_batch, toString(_source_sha256) AS cursor_digest',
			'FROM ' +
				quoteHubbleIdentifier(executor.database) +
				'.' +
				definition.table,
			'WHERE ' + where.join(' AND '),
			'ORDER BY ' + ordering,
			'LIMIT {row_limit:UInt32} FORMAT JSON'
		].join('\n'),
		parameters
	);
	const rows = boundedRows(response.data, limit + 1);
	const items = rows.slice(0, limit).map(normalizeAliases);
	const last = items.at(-1);
	return {
		items,
		limit,
		nextCursor:
			rows.length > limit && last
				? encodeTransactionCursor({
						version: 1,
						...scope,
						position: position(last)
					})
				: null
	};
}
function position(row: Row): TransactionPosition {
	return {
		key: transactionInteger(row.cursor_key, 'cursor key'),
		index: transactionNumber(row.cursor_index, 'cursor index'),
		row: transactionInteger(row.cursor_row, 'cursor row'),
		batch: String(row.cursor_batch),
		digest: String(row.cursor_digest)
	};
}
function normalizeAliases(row: Row): Row {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key.startsWith('record_') ? key.slice(7) : key,
			value
		])
	);
}
function boundedRows(
	data: readonly Row[] | undefined,
	maximum: number
): readonly Row[] {
	if (!Array.isArray(data) || data.length > maximum)
		throw new HubbleWarehouseUnavailableError(
			'Transaction warehouse returned an invalid or oversized page'
		);
	return data;
}
