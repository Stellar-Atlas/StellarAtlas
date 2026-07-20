export interface DatabasePoolPolicy {
	readonly connectionTimeoutMs: number;
	readonly poolSize: number;
}

const defaultConnectionTimeoutMs = 10_000;
const defaultPoolSize = 10;
const positiveDecimal = /^[1-9]\d*$/;

export function resolveDatabasePoolPolicy(
	environment: Readonly<Record<string, string | undefined>> = process.env
): DatabasePoolPolicy {
	return {
		connectionTimeoutMs: readPositiveInteger(
			environment.DATABASE_CONNECTION_TIMEOUT_MS,
			'DATABASE_CONNECTION_TIMEOUT_MS',
			defaultConnectionTimeoutMs
		),
		poolSize: readPositiveInteger(
			environment.DATABASE_POOL_SIZE,
			'DATABASE_POOL_SIZE',
			defaultPoolSize
		)
	};
}

function readPositiveInteger(
	value: string | undefined,
	name: string,
	fallback: number
): number {
	if (value === undefined) return fallback;
	if (!positiveDecimal.test(value)) {
		throw new Error(`${name} must be a positive decimal integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`${name} must be a safe positive integer`);
	}
	return parsed;
}
