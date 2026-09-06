import { resolveHubbleActivityWindow } from './HubbleActivityWindow.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import type {
	HubbleTransferInput,
	HubbleTransferPage
} from './HubbleTransferContracts.js';
import {
	encodeTransferCursor,
	transferFilterFingerprint
} from './HubbleTransferCursor.js';
import { mapHubbleTransfer, transferPosition } from './HubbleTransferMapper.js';
import { normalizeHubbleTransferInput } from './HubbleTransferValidation.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export async function queryHubbleTransferActivity(
	executor: HubbleSemanticQueryExecutor,
	request: HubbleTransferInput,
	maximumPublishedLedger: number
): Promise<HubbleTransferPage> {
	const input = normalizeHubbleTransferInput(request);
	const fingerprint = transferFilterFingerprint(input);
	const { limit, minimumLedger, maximumLedger, watermark, cursor } =
		resolveHubbleActivityWindow(
			input,
			maximumPublishedLedger,
			executor.maximumRows,
			fingerprint
		);
	if (maximumLedger === 0 || minimumLedger > maximumLedger)
		return {
			transfers: [],
			limit,
			nextCursor: null,
			watermark,
			elapsedMilliseconds: 0
		};
	const parameters: HubblePreparedParameter[] = [];
	const parameter = (
		name: string,
		type: string,
		value: string | number
	): string => {
		parameters.push({ name, type, value: String(value) });
		return '{' + name + ':' + type + '}';
	};
	const where = [
		completedHubbleBatchPredicate(executor.database),
		'_ledger_sequence >= ' +
			parameter('minimum_ledger', 'UInt32', minimumLedger),
		'_ledger_sequence <= ' +
			parameter('maximum_ledger', 'UInt32', maximumLedger),
		'ledger_sequence >= {minimum_ledger:UInt32}',
		'ledger_sequence <= {maximum_ledger:UInt32}'
	];
	appendFilters(input, where, parameter);
	if (cursor !== undefined) {
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
		'SELECT ledger_sequence, toString(closed_at) AS closed_at, transaction_hash,',
		' toString(transaction_id) AS transaction_id, toString(operation_id) AS operation_id,',
		' `from`, `to`, to_muxed, asset, asset_type, asset_code, asset_issuer,',
		' contract_id, event_topic, amount_raw, toString(_row_number) AS cursor_row,',
		' toString(_batch_id) AS cursor_batch, toString(_source_sha256) AS cursor_digest',
		'FROM ' + quoteHubbleIdentifier(executor.database) + '.token_transfers',
		'WHERE ' + where.join('\n AND '),
		'ORDER BY _ledger_sequence DESC, _row_number DESC, toString(_batch_id) DESC, toString(_source_sha256) DESC',
		'LIMIT ' + parameter('row_limit', 'UInt32', limit + 1),
		// Server-managed read-only profile owns time, memory, and result budgets.
		'FORMAT JSON'
	].join('\n');
	const started = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	const rows = response.data ?? [];
	if (rows.length > limit + 1)
		throw new HubbleWarehouseUnavailableError(
			'Transfer warehouse exceeded the bounded page size'
		);
	const selected = rows.slice(0, limit);
	const transfers = selected.map(mapHubbleTransfer);
	const last = selected.at(-1);
	return {
		transfers,
		limit,
		watermark,
		nextCursor:
			rows.length > limit && last !== undefined
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

type Parameter = (name: string, type: string, value: string | number) => string;
function appendFilters(
	input: HubbleTransferInput,
	where: string[],
	parameter: Parameter
): void {
	if (input.account !== undefined) {
		const value = parameter('account', 'String', input.account);
		where.push(
			'(`from` = ' +
				value +
				' OR `to` = ' +
				value +
				' OR to_muxed = ' +
				value +
				')'
		);
	}
	for (const [name, field] of [
		['from', '`from`'],
		['to', '`to`'],
		['contractId', 'contract_id'],
		['transactionHash', 'transaction_hash'],
		['eventTopic', 'event_topic']
	] as const) {
		const value = input[name];
		if (value !== undefined)
			where.push(field + ' = ' + parameter(name, 'String', value));
	}
	if (input.asset === 'native') where.push("asset_type = 'native'");
	else if (input.asset !== undefined) {
		const [code, issuer] = input.asset.split(':');
		where.push('asset_code = ' + parameter('asset_code', 'String', code!));
		where.push(
			'asset_issuer = ' + parameter('asset_issuer', 'String', issuer!)
		);
	}
	for (const [name, operator] of [
		['amountRaw', '='],
		['minAmountRaw', '>='],
		['maxAmountRaw', '<=']
	] as const) {
		const value = input[name];
		if (value !== undefined)
			where.push(
				'toInt128OrNull(amount_raw) ' +
					operator +
					' ' +
					parameter(name, 'Int128', value)
			);
	}
	for (const [name, operator] of [
		['startTime', '>='],
		['endTime', '<']
	] as const) {
		const value = input[name];
		if (value !== undefined)
			where.push(
				'closed_at ' +
					operator +
					' parseDateTime64BestEffort(' +
					parameter(name, 'String', value) +
					", 3, 'UTC')"
			);
	}
}
