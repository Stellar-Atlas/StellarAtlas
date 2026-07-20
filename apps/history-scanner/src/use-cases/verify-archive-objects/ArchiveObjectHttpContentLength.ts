export function readArchiveObjectContentLength(
	headers: unknown
): number | null {
	const value = readHeader(headers, 'content-length');
	if (value === null) return null;
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) return null;

	const parsed = Number(normalized);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function readHeader(headers: unknown, name: string): string | null {
	if (!isRecord(headers)) return null;
	const get = Reflect.get(headers, 'get');
	if (typeof get === 'function') {
		try {
			return normalizeHeaderValue(Reflect.apply(get, headers, [name]));
		} catch {
			return null;
		}
	}

	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return normalizeHeaderValue(value);
	}
	return null;
}

function normalizeHeaderValue(value: unknown): string | null {
	if (Array.isArray(value)) {
		return value.length === 0 ? null : normalizeHeaderValue(value[0]);
	}
	return typeof value === 'string' || typeof value === 'number'
		? String(value)
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
