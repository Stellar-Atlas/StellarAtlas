import type { HubbleColumn, HubbleFilter } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

interface QueryParameter {
	readonly name: string;
	readonly type: string;
	readonly value: string;
}

const columnIdentifierPattern = /^[a-z_][a-z0-9_]*$/;
const maximumFilterValues = 1_000;

export function buildFilter(
	columns: ReadonlyMap<string, HubbleColumn>,
	filter: HubbleFilter,
	index: number,
	parameters: QueryParameter[]
): string {
	const column = requireColumn(columns, filter.field);
	const expression = quote(column.name);
	const operator = filter.operator ?? 'eq';
	if (operator === 'is_null') return 'isNull(' + expression + ')';
	if (operator === 'is_not_null') return 'isNotNull(' + expression + ')';
	if (operator === 'contains') {
		const name = 'filter_' + index;
		parameters.push({
			name,
			type: 'String',
			value: scalarString(filter.value, filter.field)
		});
		return (
			'positionCaseInsensitive(toString(' +
			expression +
			'), {' +
			name +
			':String}) > 0'
		);
	}
	const nativeType = orderedParameterType(column.type);
	if (operator === 'in') {
		const values =
			filter.values ?? (Array.isArray(filter.value) ? filter.value : []);
		if (values.length < 1 || values.length > maximumFilterValues) {
			throw new HubbleWarehouseInputError(
				'Filter ' + filter.field + ' in requires 1 to 1000 values'
			);
		}
		const placeholders = values.map((value, valueIndex) => {
			const name = 'filter_' + index + '_' + valueIndex;
			const strategy = equalityStrategy(column.type);
			parameters.push({
				name,
				type: strategy.type,
				value: scalarString(value, filter.field)
			});
			return '{' + name + ':' + strategy.type + '}';
		});
		const strategy = equalityStrategy(column.type);
		return (
			strategy.expression(expression) + ' IN (' + placeholders.join(', ') + ')'
		);
	}
	const operators: Readonly<Record<string, string>> = {
		eq: '=',
		gt: '>',
		gte: '>=',
		lt: '<',
		lte: '<=',
		ne: '!='
	};
	const sqlOperator = operators[operator];
	if (sqlOperator === undefined) {
		throw new HubbleWarehouseInputError(
			'Unsupported filter operator: ' + operator
		);
	}
	const range =
		operator === 'gt' ||
		operator === 'gte' ||
		operator === 'lt' ||
		operator === 'lte';
	const strategy = range
		? {
				expression: (value: string) => value,
				type: nativeType
			}
		: equalityStrategy(column.type);
	if (range && nativeType === 'String') {
		throw new HubbleWarehouseInputError(
			'Range filtering is not supported for ' +
				column.name +
				' (' +
				column.type +
				')'
		);
	}
	const name = 'filter_' + index;
	parameters.push({
		name,
		type: strategy.type,
		value: scalarString(filter.value, filter.field)
	});
	return (
		strategy.expression(expression) +
		' ' +
		sqlOperator +
		' {' +
		name +
		':' +
		strategy.type +
		'}'
	);
}

function equalityStrategy(type: string): {
	readonly expression: (value: string) => string;
	readonly type: string;
} {
	const nativeType = orderedParameterType(type);
	if (nativeType !== 'String') {
		return { expression: (value) => value, type: nativeType };
	}
	return {
		expression: (value) => 'toString(' + value + ')',
		type: 'String'
	};
}

function orderedParameterType(type: string): string {
	let current = type.trim();
	for (;;) {
		const match = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(current);
		if (match === null) break;
		current = match[1]!.trim();
	}
	if (
		/^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Bool|Date|Date32|DateTime(?:64)?(?:\(.*\))?|Decimal(?:32|64|128|256)?(?:\(.*\))?|UUID)$/.test(
			current
		)
	) {
		return current;
	}
	return 'String';
}

export function requireColumn(
	columns: ReadonlyMap<string, HubbleColumn>,
	field: string
): HubbleColumn {
	if (!columnIdentifierPattern.test(field)) {
		throw new HubbleWarehouseInputError('Invalid Hubble column: ' + field);
	}
	const column = columns.get(field);
	if (column === undefined) {
		throw new HubbleWarehouseInputError('Unknown Hubble column: ' + field);
	}
	return column;
}

export function selectExpression(column: HubbleColumn): string {
	const identifier = quote(column.name);
	if (is64BitColumn(column)) {
		return 'toString(' + identifier + ') AS ' + quote(outputField(column));
	}
	return identifier;
}

export function normalizeSelectedRow(
	row: Readonly<Record<string, unknown>>,
	selected: readonly string[],
	columns: ReadonlyMap<string, HubbleColumn>
): Record<string, unknown> {
	return Object.fromEntries(
		selected.map((field) => {
			const column = requireColumn(columns, field);
			return [field, row[outputField(column)]];
		})
	);
}

function outputField(column: HubbleColumn): string {
	return is64BitColumn(column) ? '__hubble_64_' + column.name : column.name;
}

function is64BitColumn(column: HubbleColumn): boolean {
	return /^(?:U?Int64|Nullable\(U?Int64\))$/.test(column.type);
}

export function quote(identifier: string): string {
	if (!columnIdentifierPattern.test(identifier)) {
		throw new HubbleWarehouseInputError(
			'Invalid Hubble SQL identifier: ' + identifier
		);
	}
	return '`' + identifier + '`';
}

function scalarString(value: unknown, field: string): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	throw new HubbleWarehouseInputError(
		'Filter ' + field + ' requires a string, number, or boolean value'
	);
}

export function parseBoundedInteger(
	value: number,
	minimum: number,
	maximum: number,
	field: string
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new HubbleWarehouseInputError(
			field + ' must be an integer between ' + minimum + ' and ' + maximum
		);
	}
	return value;
}

export function optionalIntegerString(
	value: number | string | null | undefined
): string | null {
	if (value === undefined || value === null || value === '') return null;
	return String(value);
}

export function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
