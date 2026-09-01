import express, { type Request, type Response, Router } from 'express';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError,
	type HubbleFilter,
	type HubbleFilterOperator,
	type HubbleOrder,
	type HubbleQuery,
	type HubbleWarehouse
} from './HubbleWarehouseClient.js';

export interface HubbleWarehouseRouterConfig {
	readonly warehouse: HubbleWarehouse;
}

const operators = new Set<HubbleFilterOperator>([
	'contains',
	'eq',
	'gt',
	'gte',
	'in',
	'is_not_null',
	'is_null',
	'lt',
	'lte',
	'ne'
]);

const reservedQueryParameters = new Set(['limit', 'offset', 'order', 'select']);

export function hubbleWarehouseRouter(
	config: HubbleWarehouseRouterConfig
): Router {
	const router = express.Router();

	router.get('/datasets', async (_request, response) => {
		await send(response, async () => {
			response.setHeader('Cache-Control', 'public, max-age=10');
			return config.warehouse.catalog();
		});
	});

	router.get('/datasets/:dataset', async (request, response) => {
		await send(response, async () => {
			const catalog = await config.warehouse.catalog();
			const dataset = catalog.datasets.find(
				(candidate) => candidate.name === request.params.dataset
			);
			if (dataset === undefined) {
				throw new HubbleWarehouseInputError(
					'Unknown Hubble dataset: ' + request.params.dataset
				);
			}
			response.setHeader('Cache-Control', 'public, max-age=10');
			return {
				database: catalog.database,
				dataset,
				generatedAt: catalog.generatedAt,
				ingestion: catalog.ingestion,
				officialSchemaSource: catalog.officialSchemaSource
			};
		});
	});

	router.post('/query', async (request, response) => {
		await send(response, async () => {
			response.setHeader('Cache-Control', 'no-store');
			return config.warehouse.query(parseBodyQuery(request.body));
		});
	});

	router.get('/:dataset', async (request, response) => {
		await send(response, async () => {
			response.setHeader('Cache-Control', 'no-store');
			return config.warehouse.query(parseResourceQuery(request));
		});
	});

	return router;
}

async function send(
	response: Response,
	action: () => Promise<unknown>
): Promise<void> {
	try {
		response.status(200).json(await action());
	} catch (error) {
		if (error instanceof HubbleWarehouseInputError) {
			response.status(400).json({
				code: 'invalid_hubble_query',
				error: error.message
			});
			return;
		}
		if (error instanceof HubbleWarehouseUnavailableError) {
			console.error('Hubble warehouse request failed', error);
			response.status(503).json({
				code: 'hubble_warehouse_unavailable',
				error: 'The Hubble warehouse is temporarily unavailable'
			});
			return;
		}
		console.error('Unexpected Hubble API failure', error);
		response.status(500).json({
			code: 'hubble_query_failed',
			error: 'The Hubble query could not be completed'
		});
	}
}

function parseBodyQuery(value: unknown): HubbleQuery {
	const body = requireRecord(value, 'request body');
	const dataset = requireString(body.dataset, 'dataset');
	return {
		dataset,
		filters:
			body.filters === undefined
				? undefined
				: requireArray(body.filters, 'filters').map(parseFilter),
		limit:
			body.limit === undefined ? undefined : requireNumber(body.limit, 'limit'),
		offset:
			body.offset === undefined
				? undefined
				: requireNumber(body.offset, 'offset'),
		orderBy:
			body.orderBy === undefined
				? undefined
				: requireArray(body.orderBy, 'orderBy').map(parseOrder),
		select:
			body.select === undefined
				? undefined
				: requireArray(body.select, 'select').map((field) =>
						requireString(field, 'select field')
					)
	};
}

function parseFilter(value: unknown): HubbleFilter {
	const filter = requireRecord(value, 'filter');
	const operator =
		filter.operator === undefined
			? undefined
			: parseOperator(requireString(filter.operator, 'filter operator'));
	return {
		field: requireString(filter.field, 'filter field'),
		operator,
		value: filter.value,
		values:
			filter.values === undefined
				? undefined
				: requireArray(filter.values, 'filter values')
	};
}

function parseOrder(value: unknown): HubbleOrder {
	const order = requireRecord(value, 'order');
	const direction =
		order.direction === undefined
			? undefined
			: requireString(order.direction, 'order direction');
	if (direction !== undefined && direction !== 'asc' && direction !== 'desc') {
		throw new HubbleWarehouseInputError('order direction must be asc or desc');
	}
	return {
		direction,
		field: requireString(order.field, 'order field')
	};
}

function parseResourceQuery(request: Request): HubbleQuery {
	const filters: HubbleFilter[] = [];
	for (const [key, rawValue] of Object.entries(request.query)) {
		if (reservedQueryParameters.has(key)) continue;
		const match =
			/^(?<field>[a-z][a-z0-9_]*?)(?:__(?<operator>contains|eq|gt|gte|in|is_not_null|is_null|lt|lte|ne))?$/.exec(
				key
			);
		if (match?.groups === undefined) {
			throw new HubbleWarehouseInputError(
				'Invalid Hubble filter parameter: ' + key
			);
		}
		const operator = parseOperator(match.groups.operator ?? 'eq');
		const values = queryStrings(rawValue, key);
		if (operator === 'is_null' || operator === 'is_not_null') {
			filters.push({ field: match.groups.field!, operator });
			continue;
		}
		if (operator === 'in') {
			filters.push({
				field: match.groups.field!,
				operator,
				values: values.flatMap((value) =>
					value.split(',').filter((entry) => entry !== '')
				)
			});
			continue;
		}
		if (values.length !== 1) {
			throw new HubbleWarehouseInputError(
				'Hubble filter ' + key + ' accepts exactly one value'
			);
		}
		filters.push({
			field: match.groups.field!,
			operator,
			value: values[0]
		});
	}
	return {
		dataset: request.params.dataset,
		filters,
		limit: optionalQueryInteger(request.query.limit, 'limit'),
		offset: optionalQueryInteger(request.query.offset, 'offset'),
		orderBy: parseResourceOrder(
			optionalQueryString(request.query.order, 'order')
		),
		select: parseResourceSelect(
			optionalQueryString(request.query.select, 'select')
		)
	};
}

function parseResourceOrder(
	value: string | undefined
): HubbleOrder[] | undefined {
	if (value === undefined || value === '') return undefined;
	return value.split(',').map((entry) => {
		const trimmed = entry.trim();
		if (trimmed === '') {
			throw new HubbleWarehouseInputError(
				'order cannot contain an empty field'
			);
		}
		if (trimmed.startsWith('-')) {
			return { direction: 'desc', field: trimmed.slice(1) };
		}
		if (trimmed.startsWith('+')) {
			return { direction: 'asc', field: trimmed.slice(1) };
		}
		return { direction: 'asc', field: trimmed };
	});
}

function parseResourceSelect(value: string | undefined): string[] | undefined {
	if (value === undefined || value === '') return undefined;
	const fields = value.split(',').map((field) => field.trim());
	if (fields.some((field) => field === '')) {
		throw new HubbleWarehouseInputError('select cannot contain an empty field');
	}
	return fields;
}

function optionalQueryInteger(
	value: unknown,
	field: string
): number | undefined {
	const text = optionalQueryString(value, field);
	if (text === undefined) return undefined;
	if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
		throw new HubbleWarehouseInputError(field + ' must be an integer');
	}
	const parsed = Number(text);
	if (!Number.isSafeInteger(parsed)) {
		throw new HubbleWarehouseInputError(field + ' is too large');
	}
	return parsed;
}

function optionalQueryString(
	value: unknown,
	field: string
): string | undefined {
	if (value === undefined) return undefined;
	const values = queryStrings(value, field);
	if (values.length !== 1) {
		throw new HubbleWarehouseInputError(field + ' accepts exactly one value');
	}
	return values[0];
}

function queryStrings(value: unknown, field: string): string[] {
	if (typeof value === 'string') return [value];
	if (
		Array.isArray(value) &&
		value.every((entry): entry is string => typeof entry === 'string')
	) {
		return value;
	}
	throw new HubbleWarehouseInputError(
		field + ' must contain only string values'
	);
}

function parseOperator(value: string): HubbleFilterOperator {
	if (!operators.has(value as HubbleFilterOperator)) {
		throw new HubbleWarehouseInputError(
			'Unsupported Hubble filter operator: ' + value
		);
	}
	return value as HubbleFilterOperator;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new HubbleWarehouseInputError(field + ' must be an object');
	}
	return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new HubbleWarehouseInputError(field + ' must be an array');
	}
	return value;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new HubbleWarehouseInputError(field + ' must be a non-empty string');
	}
	return value.trim();
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== 'number') {
		throw new HubbleWarehouseInputError(field + ' must be a number');
	}
	return value;
}
