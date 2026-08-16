export class ScpStatementPersistenceTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Canonical SCP persistence did not settle within ${timeoutMs}ms`);
		this.name = 'ScpStatementPersistenceTimeoutError';
	}
}

export class ScpStatementPersistenceCapacityError extends Error {
	constructor(capacity: number) {
		super(`Canonical SCP persistence buffer reached its ${capacity}-row limit`);
		this.name = 'ScpStatementPersistenceCapacityError';
	}
}

export class ScpStatementPersistenceClosedError extends Error {
	constructor() {
		super('Canonical SCP persistence buffer is closed');
		this.name = 'ScpStatementPersistenceClosedError';
	}
}

export class ScpStatementPersistenceFatalError extends Error {
	readonly cause: Error;

	constructor(cause: Error) {
		super(`Canonical SCP persistence failed: ${cause.message}`);
		this.name = 'ScpStatementPersistenceFatalError';
		this.cause = cause;
	}
}

const retryablePostgresCodes = new Set([
	'40001', // serialization_failure
	'40P01', // deadlock_detected
	'53300', // too_many_connections
	'55P03', // lock_not_available / lock_timeout
	'57014', // query_canceled / statement_timeout
	'57P01', // admin_shutdown
	'57P02', // crash_shutdown
	'57P03' // cannot_connect_now
]);

export function isRetryableScpStatementPersistenceError(
	error: unknown
): boolean {
	const candidates: unknown[] = [error];
	const visited = new Set<unknown>();

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (candidate instanceof ScpStatementPersistenceTimeoutError) return true;
		if (
			candidate === null ||
			typeof candidate !== 'object' ||
			visited.has(candidate)
		) {
			continue;
		}
		visited.add(candidate);
		const record = candidate as Record<string, unknown>;
		const code = record.code;
		if (typeof code === 'string' && retryablePostgresCodes.has(code)) {
			return true;
		}

		const message = record.message;
		if (
			typeof message === 'string' &&
			/timeout exceeded when trying to connect/i.test(message.trim())
		) {
			return true;
		}

		candidates.push(record.cause, record.driverError, record.originalError);
	}

	return false;
}
