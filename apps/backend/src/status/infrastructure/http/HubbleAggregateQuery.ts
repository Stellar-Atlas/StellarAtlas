import type {
	HubbleAggregate,
	HubbleAggregateColumn
} from './HubbleAggregateContracts.js';
import type {
	HubbleCatalog,
	HubbleColumn,
	HubbleDataset,
	HubbleQuery,
	HubbleQueryResult
} from './HubbleWarehouseContracts.js';
import type { HubbleSemanticQueryExecutor } from './HubbleSemanticWarehouse.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import {
	buildFilter,
	parseBoundedInteger,
	quote,
	requireColumn
} from './HubbleWarehouseQuery.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import { isHubbleLedgerWindowComplete } from './HubbleLedgerCoverage.js';
import { maximumTransferLedgerSpan } from './HubbleTransferValidation.js';

const functions = new Set([
	'count',
	'count_distinct',
	'sum',
	'avg',
	'min',
	'max'
]);
const numeric =
	/^(?:U?Int(?:8|16|32|64)|Float(?:32|64)|Decimal(?:32|64|128)?\([0-9, ]+\))$/;
const scalar =
	/^(?:U?Int(?:8|16|32|64)|Float(?:32|64)|Bool|String|FixedString\([0-9]+\)|UUID|Date|Date32|DateTime(?:64)?(?:\(.*\))?|Decimal(?:32|64|128)?\([0-9, ]+\))$/;
function typeOf(column: HubbleColumn): string {
	let value = column.type;
	for (;;) {
		const match = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(value);
		if (!match) return value;
		value = match[1]!;
	}
}
function fail(message: string): never {
	throw new HubbleWarehouseInputError(message);
}
function decimalScale(type: string): number | null {
	if (!type.startsWith('Decimal')) return null;
	const match =
		/^Decimal(?:(32|64|128))?\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(type);
	if (!match) fail('Unsupported decimal type: ' + type);
	const precision =
		match[1] === undefined
			? Number(match[2])
			: match[1] === '32'
				? 9
				: match[1] === '64'
					? 18
					: 38;
	const scale = Number(match[1] === undefined ? match[3] : match[2]);
	if (
		precision < 1 ||
		precision > 38 ||
		!Number.isInteger(scale) ||
		scale < 0 ||
		scale > precision ||
		(match[1] !== undefined && match[3] !== undefined)
	)
		fail(
			'Decimal aggregates support precision up to 38 with a valid declared scale'
		);
	return scale;
}
function aggregateSql(
	value: HubbleAggregate,
	column: HubbleColumn | undefined
): string {
	const field = column ? quote(column.name) : '';
	if (value.function === 'count') return 'count(' + field + ')';
	if (value.function === 'count_distinct') return 'uniqExact(' + field + ')';
	const scale = column ? decimalScale(typeOf(column)) : null;
	// Widen Int64 sums before accumulation. The source's exact units are retained.
	const argument =
		value.function === 'sum' && /^U?Int/.test(typeOf(column!))
			? 'toDecimal128(' + field + ', 0)'
			: value.function === 'sum' && scale !== null
				? 'toDecimal256(' + field + ', ' + scale + ')'
				: field;
	return value.function + 'OrNull(' + argument + ')';
}
export async function queryHubbleAggregate(
	executor: HubbleSemanticQueryExecutor,
	catalog: HubbleCatalog,
	dataset: HubbleDataset,
	input: HubbleQuery
): Promise<HubbleQueryResult> {
	if (input.select !== undefined || input.distinct !== undefined)
		fail(
			'Aggregate queries use groupBy and aggregations, not select or distinct'
		);
	const metrics = input.aggregations;
	if (!Array.isArray(metrics) || metrics.length < 1 || metrics.length > 16)
		fail('aggregations must contain between 1 and 16 metrics');
	const groups = input.groupBy ?? [];
	if (
		!Array.isArray(groups) ||
		groups.length > 8 ||
		new Set(groups).size !== groups.length
	)
		fail('groupBy must contain at most 8 distinct columns');
	const minLedger = parseBoundedInteger(
		input.minLedger ?? NaN,
		1,
		2147483647,
		'minLedger'
	);
	const maxLedger = parseBoundedInteger(
		input.maxLedger ?? NaN,
		1,
		2147483647,
		'maxLedger'
	);
	if (
		maxLedger < minLedger ||
		maxLedger - minLedger + 1 > maximumTransferLedgerSpan
	)
		fail(
			'Aggregate queries require an ordered range of at most ' +
				maximumTransferLedgerSpan +
				' ledgers'
		);
	const limit = parseBoundedInteger(
		input.limit ?? 100,
		1,
		Math.min(executor.maximumRows, 1000),
		'limit'
	);
	const offset = parseBoundedInteger(input.offset ?? 0, 0, 10000, 'offset');
	if ((input.filters?.length ?? 0) > 64)
		fail('At most 64 aggregate filters are supported');
	const columns = new Map(
		dataset.columns.map((column) => [column.name, column])
	);
	requireColumn(columns, '_ledger_sequence');
	for (const field of groups)
		if (!scalar.test(typeOf(requireColumn(columns, field))))
			fail('Unsupported group column type: ' + field);
	const aliases = new Set<string>();
	const metadata: HubbleAggregateColumn[] = [];
	const innerFields = groups.map(
		(field, index) => quote(field) + ' AS __group_' + index
	);
	for (const [index, metric] of metrics.entries()) {
		if (!metric || !functions.has(metric.function))
			fail('Unsupported aggregate function');
		if (
			typeof metric.alias !== 'string' ||
			!/^[a-z][a-z0-9_]{0,63}$/.test(metric.alias) ||
			columns.has(metric.alias) ||
			aliases.has(metric.alias)
		)
			fail(
				'Aggregate aliases must be distinct identifiers and must not shadow source columns'
			);
		aliases.add(metric.alias);
		if (metric.function !== 'count' && metric.field === undefined)
			fail(metric.function + ' requires a field');
		const column =
			metric.field === undefined
				? undefined
				: requireColumn(columns, metric.field);
		const type = column ? typeOf(column) : undefined;
		if (type) decimalScale(type);
		if (type && !scalar.test(type))
			fail('Unsupported aggregate column type: ' + column!.name);
		if (
			['sum', 'avg'].includes(metric.function) &&
			(!type || !numeric.test(type))
		)
			fail(metric.function + ' requires a numeric field');
		innerFields.push(aggregateSql(metric, column) + ' AS __metric_' + index);
		metadata.push({
			alias: metric.alias,
			function: metric.function,
			field: metric.field ?? null,
			sourceType: column?.type ?? null,
			valueEncoding: 'string-or-null',
			approximate:
				metric.function !== 'count' &&
				metric.function !== 'count_distinct' &&
				(metric.function === 'avg' || /^Float/.test(type ?? ''))
		});
	}
	const parameters = [
		{ name: 'min_ledger', type: 'UInt32', value: String(minLedger) },
		{ name: 'max_ledger', type: 'UInt32', value: String(maxLedger) },
		{ name: 'limit', type: 'UInt32', value: String(limit + 1) },
		{ name: 'offset', type: 'UInt32', value: String(offset) }
	];
	const where = [
		'_ledger_sequence >= {min_ledger:UInt32}',
		'_ledger_sequence <= {max_ledger:UInt32}',
		completedHubbleBatchPredicate(executor.database),
		...(input.filters ?? []).map((filter, index) =>
			buildFilter(columns, filter, index, parameters)
		)
	];
	const output = new Map([
		...groups.map((name, index) => [name, '__group_' + index] as const),
		...metrics.map(
			(metric, index) => [metric.alias, '__metric_' + index] as const
		)
	]);
	const ordered = new Set<string>();
	const order = (input.orderBy ?? []).map((item) => {
		const field = output.get(item.field);
		if (!field)
			fail('Aggregate orderBy must name a group column or metric alias');
		const direction = item.direction ?? 'asc';
		if (direction !== 'asc' && direction !== 'desc')
			fail('Order direction must be asc or desc');
		if (ordered.has(item.field)) fail('Duplicate aggregate order field');
		ordered.add(item.field);
		return field + ' ' + direction.toUpperCase();
	});
	// Group keys break metric ties deterministically. Backfill can still change pages.
	for (const name of groups)
		if (!ordered.has(name)) order.push(output.get(name)! + ' ASC');
	const sql = [
		'SELECT ' +
			[...output.values()]
				.map((field, index) => 'toString(' + field + ') AS __value_' + index)
				.join(', '),
		'FROM (SELECT ' + innerFields.join(', '),
		'FROM ' + quote(executor.database) + '.' + quote(dataset.name),
		'WHERE ' + where.join(' AND '),
		groups.length ? 'GROUP BY ' + groups.map(quote).join(', ') : '',
		')',
		order.length ? 'ORDER BY ' + order.join(', ') : '',
		'LIMIT {limit:UInt32} OFFSET {offset:UInt32}',
		'FORMAT JSON'
	]
		.filter(Boolean)
		.join('\n');
	const started = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	const sourceRows = response.data;
	if (
		!Array.isArray(sourceRows) ||
		sourceRows.length > limit + 1 ||
		sourceRows.some(
			(row) =>
				row === null ||
				typeof row !== 'object' ||
				Array.isArray(row) ||
				[...output.keys()].some(
					(_name, index) =>
						row['__value_' + index] !== null &&
						typeof row['__value_' + index] !== 'string'
				)
		)
	)
		throw new HubbleWarehouseUnavailableError(
			'Invalid or incomplete aggregate warehouse response'
		);
	return {
		columns: [...output.keys()],
		dataset: dataset.name,
		elapsedMilliseconds: Math.round((performance.now() - started) * 100) / 100,
		limit,
		offset,
		rows: sourceRows
			.slice(0, limit)
			.map((row) =>
				Object.fromEntries(
					[...output.keys()].map((name, index) => [
						name,
						row['__value_' + index]
					])
				)
			),
		nextOffset: sourceRows.length > limit ? offset + limit : null,
		coverage: catalog.coverage,
		coverageStatus: isHubbleLedgerWindowComplete(
			catalog.coverage,
			minLedger,
			maxLedger
		)
			? 'complete'
			: 'partial_or_unknown',
		window: { minLedger, maxLedger },
		aggregates: metadata,
		semantics:
			'Aggregates of matching rows in completed, source-digest-matched batches; not reconstructed current state. Group keys and metrics are strings or null. Pagination is not snapshot-pinned.'
	};
}
