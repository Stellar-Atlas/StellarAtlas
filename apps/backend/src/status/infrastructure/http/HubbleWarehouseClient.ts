import type {
	HubbleCatalog,
	HubbleColumn,
	HubbleDataset,
	HubbleQuery,
	HubbleQueryResult,
	HubbleWarehouse
} from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import {
	buildFilter,
	requireColumn,
	unique,
	parseBoundedInteger,
	quote,
	selectExpression,
	normalizeSelectedRow,
	optionalIntegerString
} from './HubbleWarehouseQuery.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
export * from './HubbleWarehouseContracts.js';
export {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';

import { queryHubbleAccountTransactions } from './HubbleAccountTransactionQuery.js';
import { queryHubbleAssetHolders } from './HubbleAssetHolderQuery.js';
import type {
	HubbleAccountTransactionQuery,
	HubbleAssetHolderPage,
	HubbleAssetHolderQuery,
	HubbleSemanticPage
} from './HubbleSemanticWarehouse.js';

interface ClickHouseResponse<T> {
	readonly data?: readonly T[];
}

interface ClickHouseColumnRow {
	readonly name: string;
	readonly position: number | string;
	readonly table: string;
	readonly type: string;
}

interface ClickHousePartRow {
	readonly rows: string;
	readonly table: string;
}

interface ClickHouseIngestionRow {
	readonly completed_batches: string;
	readonly failed_batches: string;
	readonly maximum_ledger: number | string | null;
	readonly minimum_ledger: number | string | null;
	readonly started_batches: string;
	readonly total_rows: string;
}

interface HubbleWarehouseClientConfig {
	readonly database?: string;
	readonly endpoint: string;
	readonly fetch?: typeof fetch;
	readonly maximumRows?: number;
	readonly password?: string;
	readonly user?: string;
}

interface CatalogCache {
	readonly expiresAt: number;
	readonly value: HubbleCatalog;
}

interface QueryParameter {
	readonly name: string;
	readonly type: string;
	readonly value: string;
}

const identifierPattern = /^[a-z][a-z0-9_]*$/;
const columnIdentifierPattern = /^[a-z_][a-z0-9_]*$/;
const officialSchemaSource =
	'github.com/stellar/stellar-etl/v2/internal/transform@v2.8.23';
const catalogCacheMilliseconds = 15_000;
const defaultMaximumRows = 1_000;
const absoluteMaximumRows = 10_000;

export class ClickHouseHubbleWarehouse implements HubbleWarehouse {
	private readonly authorization: string | undefined;
	private readonly database: string;
	private readonly endpoint: URL;
	private readonly fetchImplementation: typeof fetch;
	private readonly maximumRows: number;
	private cache: CatalogCache | undefined;
	private catalogRequest: Promise<HubbleCatalog> | undefined;

	constructor(config: HubbleWarehouseClientConfig) {
		const endpoint = new URL(config.endpoint);
		if (
			(endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
			endpoint.username !== '' ||
			endpoint.password !== ''
		) {
			throw new HubbleWarehouseInputError(
				'Hubble ClickHouse endpoint must be an HTTP(S) URL without embedded credentials'
			);
		}
		const database = config.database ?? 'stellar_hubble';
		if (!identifierPattern.test(database)) {
			throw new HubbleWarehouseInputError('Invalid Hubble database name');
		}
		const maximumRows = config.maximumRows ?? defaultMaximumRows;
		if (
			!Number.isInteger(maximumRows) ||
			maximumRows < 1 ||
			maximumRows > absoluteMaximumRows
		) {
			throw new HubbleWarehouseInputError(
				'Hubble API maximum rows must be between 1 and 10000'
			);
		}
		this.endpoint = endpoint;
		this.database = database;
		this.fetchImplementation = config.fetch ?? globalThis.fetch;
		this.maximumRows = maximumRows;
		this.authorization =
			config.user === undefined || config.user === ''
				? undefined
				: 'Basic ' +
					Buffer.from(config.user + ':' + (config.password ?? '')).toString(
						'base64'
					);
	}

	async catalog(force = false): Promise<HubbleCatalog> {
		const now = Date.now();
		if (!force && this.cache !== undefined && this.cache.expiresAt > now) {
			return this.cache.value;
		}
		if (!force && this.catalogRequest !== undefined) {
			return this.catalogRequest;
		}
		const request = this.readCatalog();
		this.catalogRequest = request;
		try {
			const value = await request;
			this.cache = {
				expiresAt: Date.now() + catalogCacheMilliseconds,
				value
			};
			return value;
		} finally {
			if (this.catalogRequest === request) this.catalogRequest = undefined;
		}
	}

	async accountTransactions(
		input: HubbleAccountTransactionQuery
	): Promise<HubbleSemanticPage> {
		return queryHubbleAccountTransactions(
			{
				database: this.database,
				execute: (sql, parameters) => this.execute(sql, parameters),
				maximumRows: this.maximumRows
			},
			input
		);
	}

	async assetHolders(
		input: HubbleAssetHolderQuery
	): Promise<HubbleAssetHolderPage> {
		return queryHubbleAssetHolders(
			{
				database: this.database,
				execute: (sql, parameters) => this.execute(sql, parameters),
				maximumRows: this.maximumRows
			},
			input
		);
	}

	async query(input: HubbleQuery): Promise<HubbleQueryResult> {
		const catalog = await this.catalog();
		const dataset = catalog.datasets.find(
			(candidate) => candidate.name === input.dataset
		);
		if (dataset === undefined) {
			throw new HubbleWarehouseInputError(
				'Unknown Hubble dataset: ' + input.dataset
			);
		}
		const columns = new Map(
			dataset.columns.map((column) => [column.name, column])
		);
		const selected =
			input.select === undefined || input.select.length === 0
				? dataset.columns.map((column) => column.name)
				: unique(
						input.select.map((field) => requireColumn(columns, field).name)
					);
		const limit = parseBoundedInteger(
			input.limit ?? 100,
			1,
			this.maximumRows,
			'limit'
		);
		const offset = parseBoundedInteger(
			input.offset ?? 0,
			0,
			Number.MAX_SAFE_INTEGER,
			'offset'
		);
		const parameters: QueryParameter[] = [];
		const where = [
			completedHubbleBatchPredicate(this.database),
			...(input.filters ?? []).map((filter, index) =>
				buildFilter(columns, filter, index, parameters)
			)
		];
		const order = (input.orderBy ?? []).map((item) => {
			const column = requireColumn(columns, item.field);
			const direction = item.direction ?? 'asc';
			if (direction !== 'asc' && direction !== 'desc') {
				throw new HubbleWarehouseInputError(
					'Order direction must be asc or desc'
				);
			}
			return quote(column.name) + ' ' + direction.toUpperCase();
		});
		parameters.push(
			{ name: 'limit', type: 'UInt32', value: String(limit) },
			{ name: 'offset', type: 'UInt64', value: String(offset) }
		);
		const sql = [
			'SELECT ' +
				selected
					.map((field) => selectExpression(requireColumn(columns, field)))
					.join(', '),
			'FROM ' + quote(this.database) + '.' + quote(dataset.name),
			where.length === 0 ? '' : 'WHERE ' + where.join(' AND '),
			order.length === 0 ? '' : 'ORDER BY ' + order.join(', '),
			'LIMIT {limit:UInt32} OFFSET {offset:UInt64}',
			'FORMAT JSON'
		]
			.filter((part) => part !== '')
			.join('\n');
		const startedAt = performance.now();
		const response = await this.execute<Record<string, unknown>>(
			sql,
			parameters
		);
		return {
			columns: selected,
			dataset: dataset.name,
			elapsedMilliseconds:
				Math.round((performance.now() - startedAt) * 100) / 100,
			limit,
			offset,
			rows: (response.data ?? []).map((row) =>
				normalizeSelectedRow(row, selected, columns)
			)
		};
	}

	private async readCatalog(): Promise<HubbleCatalog> {
		const databaseParameter: QueryParameter = {
			name: 'database',
			type: 'String',
			value: this.database
		};
		const [columnResponse, partResponse, ingestionResponse] = await Promise.all(
			[
				this.execute<ClickHouseColumnRow>(
					`SELECT table, name, type, position
FROM system.columns
WHERE database={database:String} AND NOT startsWith(table, '_')
ORDER BY table, position
FORMAT JSON`,
					[databaseParameter]
				),
				this.execute<ClickHousePartRow>(
					`SELECT table, toString(sum(rows)) AS rows
FROM system.parts
WHERE active AND database={database:String} AND NOT startsWith(table, '_')
GROUP BY table
FORMAT JSON`,
					[databaseParameter]
				),
				this.execute<ClickHouseIngestionRow>(
					`SELECT
	toString(countIf(status='complete')) AS completed_batches,
	toString(countIf(status='failed')) AS failed_batches,
	toString(countIf(status='started')) AS started_batches,
	toString(sumIf(row_count, status='complete')) AS total_rows,
	nullIf(toString(minIf(start_ledger, status='complete')), '0') AS minimum_ledger,
	nullIf(toString(maxIf(end_ledger, status='complete')), '0') AS maximum_ledger
FROM ${quote(this.database)}._ingestion_batches FINAL
FORMAT JSON`,
					[]
				)
			]
		);
		const rowsByTable = new Map(
			(partResponse.data ?? []).map((row) => [row.table, row.rows])
		);
		const datasets = new Map<string, HubbleColumn[]>();
		for (const row of columnResponse.data ?? []) {
			if (
				!identifierPattern.test(row.table) ||
				!columnIdentifierPattern.test(row.name)
			) {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned an invalid Hubble schema identifier'
				);
			}
			const position = Number(row.position);
			if (!Number.isSafeInteger(position) || position < 1) {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned an invalid Hubble column position'
				);
			}
			const columns = datasets.get(row.table) ?? [];
			columns.push({ name: row.name, position, type: row.type });
			datasets.set(row.table, columns);
		}
		const ingestion = ingestionResponse.data?.[0];
		return {
			database: this.database,
			datasets: [...datasets.entries()].map(([name, columns]) => ({
				columns,
				name,
				rowCount: rowsByTable.get(name) ?? '0'
			})),
			generatedAt: new Date().toISOString(),
			ingestion: {
				completedBatches: ingestion?.completed_batches ?? '0',
				failedBatches: ingestion?.failed_batches ?? '0',
				maximumLedger: optionalIntegerString(ingestion?.maximum_ledger),
				minimumLedger: optionalIntegerString(ingestion?.minimum_ledger),
				startedBatches: ingestion?.started_batches ?? '0',
				totalRows: ingestion?.total_rows ?? '0'
			},
			officialSchemaSource
		};
	}

	private async execute<T>(
		sql: string,
		parameters: readonly QueryParameter[]
	): Promise<ClickHouseResponse<T>> {
		const url = new URL(this.endpoint);
		url.searchParams.set('query', sql);
		for (const parameter of parameters) {
			url.searchParams.set('param_' + parameter.name, parameter.value);
		}
		const headers: Record<string, string> = {
			Accept: 'application/json'
		};
		if (this.authorization !== undefined) {
			headers.Authorization = this.authorization;
		}
		try {
			const response = await this.fetchImplementation(url, {
				headers,
				method: 'POST',
				signal: AbortSignal.timeout(30_000)
			});
			const body = await response.text();
			if (!response.ok) {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned HTTP ' +
						response.status +
						': ' +
						body.slice(0, 512)
				);
			}
			const parsed: unknown = JSON.parse(body);
			if (parsed === null || typeof parsed !== 'object') {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned an invalid JSON response'
				);
			}
			return parsed as ClickHouseResponse<T>;
		} catch (error) {
			if (error instanceof HubbleWarehouseUnavailableError) throw error;
			throw new HubbleWarehouseUnavailableError(
				'Hubble ClickHouse query failed',
				{ cause: error }
			);
		}
	}
}

class UnavailableHubbleWarehouse implements HubbleWarehouse {
	constructor(private readonly reason: string) {}

	async accountTransactions(): Promise<HubbleSemanticPage> {
		throw new HubbleWarehouseUnavailableError(this.reason);
	}

	async assetHolders(): Promise<HubbleAssetHolderPage> {
		throw new HubbleWarehouseUnavailableError(this.reason);
	}

	async catalog(): Promise<HubbleCatalog> {
		throw new HubbleWarehouseUnavailableError(this.reason);
	}

	async query(): Promise<HubbleQueryResult> {
		throw new HubbleWarehouseUnavailableError(this.reason);
	}
}

export function hubbleWarehouseFromEnvironment(
	environment: NodeJS.ProcessEnv = process.env
): HubbleWarehouse {
	const endpoint = environment.HUBBLE_CLICKHOUSE_URL?.trim();
	if (endpoint === undefined || endpoint === '') {
		return new UnavailableHubbleWarehouse(
			'HUBBLE_CLICKHOUSE_URL is not configured'
		);
	}
	const parsedMaximumRows =
		environment.HUBBLE_API_MAX_ROWS === undefined
			? defaultMaximumRows
			: Number(environment.HUBBLE_API_MAX_ROWS);
	return new ClickHouseHubbleWarehouse({
		database: environment.HUBBLE_CLICKHOUSE_DATABASE,
		endpoint,
		maximumRows: parsedMaximumRows,
		password: environment.HUBBLE_CLICKHOUSE_PASSWORD,
		user: environment.HUBBLE_CLICKHOUSE_USER
	});
}
