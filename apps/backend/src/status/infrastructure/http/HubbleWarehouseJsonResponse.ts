import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

export interface ClickHouseResponse<T> {
	readonly data: readonly T[];
}

export async function readHubbleWarehouseJson<T>(
	response: Response,
	signal: AbortSignal
): Promise<ClickHouseResponse<T>> {
	const exception = response.headers.get('x-clickhouse-exception-code');
	if (signal.aborted || !response.ok || (exception !== null && exception !== '0')) {
		void response.body?.cancel().catch(() => {});
		if (signal.aborted)
			throw new HubbleWarehouseUnavailableError('ClickHouse response canceled');
		const code = exception !== null && /^[1-9][0-9]{0,5}$/.test(exception)
			? ` (exception ${exception})`
			: '';
		throw new HubbleWarehouseUnavailableError(
			`ClickHouse rejected the query (HTTP ${response.status})${code}`
		);
	}
	// Wait for a complete body: ClickHouse can report an exception after HTTP 200
	// and a chunked response may terminate after even a syntactically valid prefix.
	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new HubbleWarehouseUnavailableError(
			signal.aborted ? 'ClickHouse response canceled' : `ClickHouse response body read failed (HTTP ${response.status})`
		);
	}
	if (signal.aborted)
		throw new HubbleWarehouseUnavailableError('ClickHouse response canceled');
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		// JSON.parse errors can contain a fragment of the upstream body.
		throw new HubbleWarehouseUnavailableError('ClickHouse returned incomplete or invalid JSON');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new HubbleWarehouseUnavailableError('ClickHouse returned an invalid result envelope');
	if (Object.hasOwn(parsed, 'exception'))
		throw new HubbleWarehouseUnavailableError('ClickHouse reported a query exception in the result');
	const record = parsed as Record<string, unknown>;
	if (!Array.isArray(record.data) || record.data.some((row: unknown) =>
		row === null || typeof row !== 'object' || Array.isArray(row)
	)) throw new HubbleWarehouseUnavailableError('ClickHouse returned an invalid data array');
	if (Object.hasOwn(record, 'rows')) {
		const count = typeof record.rows === 'string' && /^\d{1,16}$/.test(record.rows)
			? Number(record.rows)
			: record.rows;
		if (count !== record.data.length)
			throw new HubbleWarehouseUnavailableError('ClickHouse returned an inconsistent row count');
	}
	return record as unknown as ClickHouseResponse<T>;
}
