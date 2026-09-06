import { createHash } from 'node:crypto';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import { resolveHubbleActivityWindow } from './HubbleActivityWindow.js';
import { encodeTransferCursor } from './HubbleTransferCursor.js';
import { transferPosition } from './HubbleTransferMapper.js';
import { classifyHubbleEventRows } from './HubbleEventRelationshipQuery.js';
import { mapTransactionEvent } from './HubbleTransactionMapper.js';
import { normalizeHubbleContractEventInput } from './HubbleContractEventValidation.js';
import type {
	HubbleContractEventInput,
	HubbleContractEventPage
} from './HubbleContractEventContracts.js';
import type { HubbleLedgerCoverage } from './HubbleLedgerCoverage.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export async function queryHubbleContractEvents(
	executor: HubbleSemanticQueryExecutor,
	request: HubbleContractEventInput,
	coverage: HubbleLedgerCoverage
): Promise<HubbleContractEventPage> {
	const input = normalizeHubbleContractEventInput(request);
	const fingerprint = createHash('sha256')
		.update('contract-events:')
		.update(
			JSON.stringify(
				Object.entries(input)
					.filter(([key]) => key !== 'after' && key !== 'limit')
					.sort(([left], [right]) => left.localeCompare(right))
			)
		)
		.digest('hex');
	const { limit, minimumLedger, maximumLedger, watermark, cursor } =
		resolveHubbleActivityWindow(
			input,
			Number(coverage.maximumLedger ?? 0),
			executor.maximumRows,
			fingerprint
		);
	const page = { contractId: input.contractId, limit, watermark, coverage };
	if (maximumLedger === 0 || minimumLedger > maximumLedger)
		return { ...page, items: [], nextCursor: null, elapsedMilliseconds: 0 };
	const parameters: HubblePreparedParameter[] = [];
	const parameter = (
		name: string,
		type: string,
		value: string | number | boolean
	): string => {
		parameters.push({
			name,
			type,
			value: typeof value === 'boolean' ? String(Number(value)) : String(value)
		});
		return '{' + name + ':' + type + '}';
	};
	const where = [
		completedHubbleBatchPredicate(executor.database),
		'_ledger_sequence >= ' +
			parameter('minimum_ledger', 'UInt32', minimumLedger),
		'_ledger_sequence <= ' +
			parameter('maximum_ledger', 'UInt32', maximumLedger),
		'ledger_sequence >= {minimum_ledger:UInt32}',
		'ledger_sequence <= {maximum_ledger:UInt32}',
		'contract_id = ' + parameter('contract_id', 'String', input.contractId)
	];
	for (const [name, column, type] of [
		['transactionHash', 'transaction_hash', 'String'],
		['typeCode', 'type', 'Int32'],
		['successful', 'successful', 'Bool'],
		['inSuccessfulContractCall', 'in_successful_contract_call', 'Bool']
	] as const) {
		const value = input[name];
		if (value !== undefined)
			where.push(column + ' = ' + parameter(name, type, value));
	}
	for (const [name, operator] of [
		['startTime', '>='],
		['endTime', '<']
	] as const)
		if (input[name] !== undefined)
			where.push(
				'closed_at ' +
					operator +
					' parseDateTime64BestEffort(' +
					parameter(name, 'String', input[name]!) +
					", 3, 'UTC')"
			);
	if (cursor) {
		const position = cursor.position;
		where.push(
			'tuple(_ledger_sequence, _row_number, toString(_batch_id), toString(_source_sha256)) < tuple(' +
				parameter('after_ledger', 'UInt32', position.ledger) +
				', ' +
				parameter('after_row', 'UInt64', position.row) +
				', ' +
				parameter('after_batch', 'String', position.batch) +
				', ' +
				parameter('after_digest', 'String', position.digest) +
				')'
		);
	}
	const sql = [
		'SELECT ledger_sequence, closed_at, transaction_hash, toString(transaction_id) AS transaction_id,',
		' toString(operation_id) AS operation_id, contract_id, type, type_string, successful, in_successful_contract_call,',
		' topics_decoded, data_decoded, contract_event_xdr, toString(_row_number) AS cursor_row,',
		' toString(_batch_id) AS cursor_batch, toString(_source_sha256) AS cursor_digest',
		'FROM ' +
			quoteHubbleIdentifier(executor.database) +
			'.history_contract_events',
		'WHERE ' + where.join(' AND '),
		'ORDER BY _ledger_sequence DESC, _row_number DESC, toString(_batch_id) DESC, toString(_source_sha256) DESC',
		'LIMIT ' + parameter('row_limit', 'UInt32', limit + 1),
		'FORMAT JSON'
	].join('\n');
	const started = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	if (!Array.isArray(response.data) || response.data.length > limit + 1)
		throw new HubbleWarehouseUnavailableError(
			'Incomplete or oversized contract-event page'
		);
	const selected = response.data.slice(0, limit);
	const classified = await classifyHubbleEventRows(executor, selected);
	const last = selected.at(-1);
	return {
		...page,
		items: classified.map(mapTransactionEvent),
		nextCursor:
			response.data.length > limit && last !== undefined
				? encodeTransferCursor({
						version: 1,
						filters: fingerprint,
						watermark,
						position: transferPosition(last)
					})
				: null,
		elapsedMilliseconds: Math.round((performance.now() - started) * 100) / 100
	};
}
