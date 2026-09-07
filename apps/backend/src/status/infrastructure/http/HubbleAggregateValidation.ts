import type {
	HubbleAggregate,
	HubbleAggregateFields,
	HubbleAggregateFunction
} from './HubbleAggregateContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
const functions = new Set([
	'count',
	'count_distinct',
	'sum',
	'avg',
	'min',
	'max'
]);
export function parseHubbleAggregateFields(
	body: Readonly<Record<string, unknown>>
): HubbleAggregateFields {
	const fields: {
		aggregations?: HubbleAggregate[];
		groupBy?: string[];
		minLedger?: number;
		maxLedger?: number;
	} = {};
	if (body.aggregations !== undefined) {
		if (
			!Array.isArray(body.aggregations) ||
			body.aggregations.length < 1 ||
			body.aggregations.length > 16
		)
			fail('aggregations requires 1 to 16 metrics');
		fields.aggregations = body.aggregations.map((value: unknown) => {
			if (!value || typeof value !== 'object' || Array.isArray(value))
				fail('Aggregate must be an object');
			const metric = value as Record<string, unknown>;
			if (
				Object.keys(metric).some(
					(key) => !['function', 'field', 'alias'].includes(key)
				)
			)
				fail('Unknown aggregate property');
			if (
				typeof metric.function !== 'string' ||
				!functions.has(metric.function)
			)
				fail('Unsupported aggregate function');
			if (
				typeof metric.alias !== 'string' ||
				!/^[a-z][a-z0-9_]{0,63}$/.test(metric.alias)
			)
				fail('Aggregate alias must be an identifier of at most 64 characters');
			if (metric.field !== undefined && typeof metric.field !== 'string')
				fail('Aggregate field must be a string');
			return {
				function: metric.function as HubbleAggregateFunction,
				alias: metric.alias,
				...(metric.field === undefined ? {} : { field: metric.field as string })
			};
		});
	}
	if (body.groupBy !== undefined) {
		if (
			!Array.isArray(body.groupBy) ||
			body.groupBy.length > 8 ||
			!body.groupBy.every((field): field is string => typeof field === 'string')
		)
			fail('groupBy must contain at most 8 field names');
		fields.groupBy = body.groupBy;
	}
	for (const name of ['minLedger', 'maxLedger'] as const)
		if (body[name] !== undefined) {
			const value = body[name];
			if (
				typeof value !== 'number' ||
				!Number.isInteger(value) ||
				value < 1 ||
				value > 2147483647
			)
				fail(name + ' must be a positive ledger integer');
			fields[name] = value;
		}
	return fields;
}
function fail(message: string): never {
	throw new HubbleWarehouseInputError(message);
}
