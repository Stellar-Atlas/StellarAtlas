import { performance } from 'node:perf_hooks';
import {
	createFullHistoryLedgerCloseMetaLinuxIoReader,
	type FullHistoryLedgerCloseMetaLinuxIoReader
} from './FullHistoryLedgerCloseMetaLinuxIo.js';
import {
	FullHistoryLedgerCloseMetaAdmissionRecovery,
	type FullHistoryLedgerCloseMetaAdmissionDecision
} from './FullHistoryLedgerCloseMetaAdmissionRecovery.js';
export type {
	FullHistoryLedgerCloseMetaAdmissionDecision,
	FullHistoryLedgerCloseMetaAdmissionReason,
	FullHistoryLedgerCloseMetaAdmissionSnapshot
} from './FullHistoryLedgerCloseMetaAdmissionRecovery.js';

export interface FullHistoryLedgerCloseMetaAdmissionPort {
	evaluate(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaAdmissionDecision>;
}

interface DatabaseProbeQuery {
	readonly query_timeout: number;
	readonly text: string;
	readonly values?: readonly unknown[];
}

export interface FullHistoryLedgerCloseMetaDatabaseClient {
	query(query: DatabaseProbeQuery): Promise<unknown>;
	release(error?: Error): void;
}

export interface FullHistoryLedgerCloseMetaDatabasePool {
	connect(): Promise<FullHistoryLedgerCloseMetaDatabaseClient>;
}

export interface LocalFullHistoryLedgerCloseMetaAdmissionOptions {
	readonly databasePool: FullHistoryLedgerCloseMetaDatabasePool;
	readonly maximumDatabaseConnectionBasisPoints: number;
	readonly maximumDatabaseProbeMilliseconds: number;
	readonly maximumIoFullPressureBasisPoints: number;
	readonly maximumIoSomePressureBasisPoints: number;
	readonly maximumMd0InflightRequests: number;
	readonly now?: () => number;
	readonly readIoPressure?: (signal: AbortSignal) => Promise<string>;
	readonly readMd0Inflight?: (signal: AbortSignal) => Promise<string>;
	readonly recoveryHealthySamplesRequired: number;
}

export class LocalFullHistoryLedgerCloseMetaAdmission implements FullHistoryLedgerCloseMetaAdmissionPort {
	readonly #databasePool: FullHistoryLedgerCloseMetaDatabasePool;
	readonly #maximumDatabaseProbeMilliseconds: number;
	readonly #now: () => number;
	readonly #readLinuxIo: FullHistoryLedgerCloseMetaLinuxIoReader;
	readonly #recovery: FullHistoryLedgerCloseMetaAdmissionRecovery;

	constructor(options: LocalFullHistoryLedgerCloseMetaAdmissionOptions) {
		this.#databasePool = options.databasePool;
		this.#maximumDatabaseProbeMilliseconds =
			options.maximumDatabaseProbeMilliseconds;
		this.#now = options.now ?? (() => performance.now());
		this.#readLinuxIo = createFullHistoryLedgerCloseMetaLinuxIoReader({
			readIoPressure: options.readIoPressure,
			readMd0Inflight: options.readMd0Inflight
		});
		this.#recovery = new FullHistoryLedgerCloseMetaAdmissionRecovery(options);
	}

	async evaluate(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaAdmissionDecision> {
		try {
			signal.throwIfAborted();
			const linuxIo = await this.#readLinuxIo(signal);
			const database = await this.#probeDatabase(signal);
			signal.throwIfAborted();
			const databaseConnections = parseDatabaseConnections(database.rows);
			const values = {
				databaseConnectionBasisPoints: ratioBasisPoints(
					databaseConnections.backendCount,
					databaseConnections.maximumUsableConnections
				),
				databaseProbeMilliseconds: database.elapsedMilliseconds,
				ioFullPressureBasisPoints: linuxIo.ioFullPressureBasisPoints,
				ioSomePressureBasisPoints: linuxIo.ioSomePressureBasisPoints,
				md0InflightRequests: linuxIo.md0InflightRequests
			};
			return this.#recovery.evaluate(values);
		} catch (cause) {
			this.#recovery.failClosed();
			throw cause;
		}
	}

	async #probeDatabase(
		signal: AbortSignal
	): Promise<{ readonly elapsedMilliseconds: number; readonly rows: unknown }> {
		const startedAt = this.#now();
		const deadline = new DatabaseProbeDeadline(
			startedAt,
			this.#maximumDatabaseProbeMilliseconds,
			this.#now
		);
		const client = await acquireDatabaseClient(
			this.#databasePool,
			deadline,
			signal
		);
		const lease = new DatabaseClientLease(client);
		try {
			await executeDatabaseQuery(
				client,
				'start transaction',
				[],
				deadline,
				signal
			);
			await executeDatabaseQuery(
				client,
				`select set_config('statement_timeout', $1, true)`,
				[`${deadline.remaining(signal)}ms`],
				deadline,
				signal
			);
			const result = await executeDatabaseQuery(
				client,
				databasePressureStatement,
				[],
				deadline,
				signal
			);
			const rows = databaseQueryRows(result);
			await executeDatabaseQuery(client, 'rollback', [], deadline, signal);
			lease.release();
			return {
				elapsedMilliseconds: elapsed(startedAt, this.#now(), 'database probe'),
				rows
			};
		} catch (cause) {
			lease.cancel(errorFrom(cause));
			throw cause;
		}
	}
}

export const unrestrictedFullHistoryLedgerCloseMetaAdmission: FullHistoryLedgerCloseMetaAdmissionPort =
	Object.freeze({
		evaluate: async () => Object.freeze({ admitted: true })
	});

const databasePressureStatement = `
	select
		coalesce(sum(database.numbackends), 0)::integer as "backendCount",
		greatest(
			1,
			current_setting('max_connections')::integer
				- current_setting('superuser_reserved_connections')::integer
				- coalesce(
					nullif(current_setting('reserved_connections', true), '')::integer,
					0
				)
		)::integer as "maximumUsableConnections"
	from pg_stat_database database
`;

class DatabaseClientLease {
	readonly #client: FullHistoryLedgerCloseMetaDatabaseClient;
	#released = false;

	constructor(client: FullHistoryLedgerCloseMetaDatabaseClient) {
		this.#client = client;
	}

	release(): void {
		if (this.#released) return;
		this.#released = true;
		this.#client.release();
	}

	cancel(error: Error): void {
		if (this.#released) return;
		this.#released = true;
		try {
			this.#client.release(error);
		} catch {
			/* The failed probe remains the primary error. */
		}
	}
}

class DatabaseProbeDeadline {
	readonly #deadline: number;
	readonly #maximumMilliseconds: number;
	readonly #now: () => number;

	constructor(
		startedAt: number,
		maximumMilliseconds: number,
		now: () => number
	) {
		this.#deadline = startedAt + maximumMilliseconds;
		this.#maximumMilliseconds = maximumMilliseconds;
		this.#now = now;
	}

	remaining(signal: AbortSignal): number {
		signal.throwIfAborted();
		const remaining = Math.ceil(this.#deadline - this.#now());
		if (!Number.isFinite(remaining) || remaining < 1) {
			throw this.timeoutError();
		}
		return remaining;
	}

	wait<T>(
		operation: Promise<T>,
		signal: AbortSignal,
		remaining: number
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (action: () => void): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				signal.removeEventListener('abort', onAbort);
				action();
			};
			const onAbort = (): void => finish(() => reject(signal.reason));
			const timeout = setTimeout(
				() => finish(() => reject(this.timeoutError())),
				remaining
			);
			timeout.unref();
			signal.addEventListener('abort', onAbort, { once: true });
			operation.then(
				(value) => finish(() => resolve(value)),
				(cause) => finish(() => reject(cause))
			);
			if (signal.aborted) onAbort();
		});
	}

	timeoutError(): Error {
		return new Error(
			`PostgreSQL admission probe exceeded ${this.#maximumMilliseconds}ms`
		);
	}
}

async function acquireDatabaseClient(
	pool: FullHistoryLedgerCloseMetaDatabasePool,
	deadline: DatabaseProbeDeadline,
	signal: AbortSignal
): Promise<FullHistoryLedgerCloseMetaDatabaseClient> {
	signal.throwIfAborted();
	const remaining = deadline.remaining(signal);
	const pending = pool.connect();
	try {
		return await deadline.wait(pending, signal, remaining);
	} catch (cause) {
		void pending
			.then((client) => {
				new DatabaseClientLease(client).cancel(errorFrom(cause));
			})
			.catch(() => undefined);
		throw cause;
	}
}

async function executeDatabaseQuery(
	client: FullHistoryLedgerCloseMetaDatabaseClient,
	text: string,
	values: readonly unknown[],
	deadline: DatabaseProbeDeadline,
	signal: AbortSignal
): Promise<unknown> {
	const queryTimeout = deadline.remaining(signal);
	const operation = client.query({ query_timeout: queryTimeout, text, values });
	return deadline.wait(operation, signal, queryTimeout);
}

function databaseQueryRows(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.rows)) {
		throw new Error('PostgreSQL admission probe returned an invalid result');
	}
	return value.rows;
}

function parseDatabaseConnections(value: unknown): {
	readonly backendCount: number;
	readonly maximumUsableConnections: number;
} {
	if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
		throw new Error('PostgreSQL admission probe returned an invalid row set');
	}
	const backendCount = nonNegativeInteger(
		value[0].backendCount,
		'PostgreSQL backend count'
	);
	const maximumUsableConnections = positiveInteger(
		value[0].maximumUsableConnections,
		'PostgreSQL maximum usable connections'
	);
	return { backendCount, maximumUsableConnections };
}

function ratioBasisPoints(numerator: number, denominator: number): number {
	return Math.min(10_000, Math.ceil((numerator * 10_000) / denominator));
}

function elapsed(start: number, finish: number, field: string): number {
	const value = finish - start;
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${field} clock returned an invalid duration`);
	}
	return value;
}

function positiveInteger(value: unknown, field: string): number {
	const parsed = numericInteger(value);
	if (parsed < 1) throw new Error(`${field} must be positive`);
	return parsed;
}

function nonNegativeInteger(value: unknown, field: string): number {
	const parsed = numericInteger(value);
	if (parsed < 0) throw new Error(`${field} cannot be negative`);
	return parsed;
}

function numericInteger(value: unknown): number {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string' && /^[0-9]+$/u.test(value)
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(parsed)) {
		throw new Error('PostgreSQL admission probe returned an invalid integer');
	}
	return parsed;
}

function isDatabaseClient(
	value: unknown
): value is FullHistoryLedgerCloseMetaDatabaseClient {
	return (
		isRecord(value) &&
		typeof value.query === 'function' &&
		typeof value.release === 'function'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function errorFrom(value: unknown): Error {
	if (value instanceof Error) return value;
	return new Error('PostgreSQL admission probe was cancelled', {
		cause: value
	});
}
