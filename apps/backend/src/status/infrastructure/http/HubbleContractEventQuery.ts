import { createHash } from 'node:crypto';
import { getHubbleContractEventSummary } from './HubbleContractEventSummary.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import { resolveHubbleActivityWindow } from './HubbleActivityWindow.js';
import { encodeTransferCursor } from './HubbleTransferCursor.js';
import { transferPosition } from './HubbleTransferMapper.js';
import { classifyHubbleEventRows } from './HubbleEventRelationshipQuery.js';
import { mapTransactionEvent } from './HubbleTransactionMapper.js';
import { normalizeHubbleContractEventInput } from './HubbleContractEventValidation.js';
import { maximumContractEventLedgerSpan } from './HubbleContractEventValidation.js';
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
					.filter(
						([key]) =>
							key !== 'after' && key !== 'limit' && key !== 'includeSummary'
					)
					.sort(([left], [right]) => left.localeCompare(right))
			)
		)
		.digest('hex');
	const { limit, minimumLedger, maximumLedger, watermark, cursor } =
		resolveHubbleActivityWindow(
			input,
			Number(coverage.maximumLedger ?? 0),
			executor.maximumRows,
			fingerprint,
			{
				defaultMinimumLedger: 2,
				maximumLedgerSpan: maximumContractEventLedgerSpan
			}
		);
	const page = { contractId: input.contractId, limit, watermark, coverage };
	if (maximumLedger === 0 || minimumLedger > maximumLedger)
		return {
			...page,
			items: [],
			nextCursor: null,
			elapsedMilliseconds: 0,
			...(input.includeSummary ? { summary: { total: '0', topics: [] } } : {})
		};
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
	if (input.topic !== undefined)
		where.push(
			"arrayExists(topic -> JSONExtractString(topic, 'symbol') = " +
				parameter('topic_filter', 'String', input.topic) +
				", JSONExtractArrayRaw(ifNull(toJSONString(topics_decoded), '[]')) )"
		);
	if (input.search !== undefined) {
		if (/^[GC][A-Z2-7]{55}$/.test(input.search)) {
			const address = parameter('search_address', 'String', input.search);
			where.push(
				"(position(ifNull(toJSONString(topics_decoded), ''), " +
					address +
					") > 0 OR position(ifNull(toJSONString(data_decoded), ''), " +
					address +
					') > 0)'
			);
		} else if (/^[a-f0-9]{64}$/.test(input.search)) {
			where.push(
				'transaction_hash = ' + parameter('search_hash', 'String', input.search)
			);
		} else {
			where.push(
				'ledger_sequence = ' +
					parameter('search_ledger', 'UInt32', Number(input.search))
			);
		}
	}
	const summaryWhere = [...where];
	const summaryParameters = [...parameters];
	const order = input.order ?? 'desc';
	const cursorOperator = order === 'asc' ? '>' : '<';
	const sortDirection = order.toUpperCase();
	if (cursor) {
		const position = cursor.position;
		where.push(
			'tuple(_ledger_sequence, _row_number, toString(_batch_id), toString(_source_sha256)) ' +
				cursorOperator +
				' tuple(' +
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
		'ORDER BY _ledger_sequence ' +
			sortDirection +
			', _row_number ' +
			sortDirection +
			', toString(_batch_id) ' +
			sortDirection +
			', toString(_source_sha256) ' +
			sortDirection,
		'LIMIT ' + parameter('row_limit', 'UInt32', limit + 1),
		'FORMAT JSON'
	].join('\n');
	const started = performance.now();
	const summary = input.includeSummary
		? await getHubbleContractEventSummary({
				executor,
				database: executor.database,
				contractId: input.contractId,
				minimumLedger,
				maximumLedger,
				fingerprint,
				where: summaryWhere,
				parameters: summaryParameters
			})
		: undefined;
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters,
		100_000
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
		...(summary === undefined ? {} : { summary }),
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
