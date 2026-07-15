export function hasPostgresSqlState(
	error: unknown,
	expectedState: string
): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 4; depth += 1) {
		if (!isRecord(current)) return false;
		if (current.code === expectedState) return true;
		current = current.driverError ?? current.cause;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
