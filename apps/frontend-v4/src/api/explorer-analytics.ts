export const analyticsCollections = [
	'operations',
	'assets',
	'contracts',
	'trades',
	'offers'
] as const;
export type AnalyticsCollection = (typeof analyticsCollections)[number];
export type EntityRecord = Readonly<Record<string, unknown>>;
export type ExplorerFilters = Readonly<Record<string, string>>;
export interface AnalyticsEntityPage {
	readonly entity: string;
	readonly rows: readonly EntityRecord[];
	readonly limit: number;
	readonly offset: number;
	readonly nextOffset: number | null;
	readonly window: { readonly minLedger: number; readonly maxLedger: number };
	readonly coverage: EntityRecord;
	readonly coverageStatus: string;
	readonly semantics: string;
}
export function isAnalyticsCollection(
	value: string
): value is AnalyticsCollection {
	return analyticsCollections.some((collection) => collection === value);
}
export function recordValue(value: unknown): EntityRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as EntityRecord)
		: {};
}
export function entityText(row: EntityRecord, key: string): string {
	const value = row[key];
	return typeof value === 'string' || typeof value === 'number'
		? String(value)
		: '';
}
export function buildEntityApiPath(
	collection: AnalyticsCollection,
	identifier: string | undefined,
	filters: ExplorerFilters,
	offset = 0
): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value.trim()) query.set(key, value.trim());
	}
	query.set('limit', '25');
	query.set('offset', String(offset));
	if (collection === 'trades' || (collection === 'operations' && identifier))
		query.set('view', 'typed');
	return (
		'/v1/analytics/' +
		collection +
		(identifier ? '/' + encodeURIComponent(identifier) : '') +
		'?' +
		query.toString()
	);
}
export function buildEntityHref(
	collection: string,
	identifier?: string,
	filters: ExplorerFilters = {}
): string {
	const query = new URLSearchParams(
		Object.entries(filters).filter(([, value]) => value.trim())
	);
	return (
		'/explorer/' +
		collection +
		(identifier ? '/' + encodeURIComponent(identifier) : '') +
		(query.size ? '?' + query.toString() : '')
	);
}
export function parseEntityPage(value: unknown): AnalyticsEntityPage {
	const data = recordValue(value);
	const window = recordValue(data.window);
	const minLedger = Number(window.minLedger),
		maxLedger = Number(window.maxLedger);
	if (
		!Number.isSafeInteger(minLedger) ||
		!Number.isSafeInteger(maxLedger) ||
		minLedger > maxLedger
	)
		throw new Error('The data service returned an invalid ledger window.');
	const rawRows = Array.isArray(data.rows)
		? data.rows
		: data.record
			? [data.record]
			: [];
	if (
		rawRows.length > 100 ||
		rawRows.some((row) => Object.keys(recordValue(row)).length === 0)
	)
		throw new Error('The data service returned invalid entity records.');
	const limit = Number(data.limit ?? 25),
		offset = Number(data.offset ?? 0);
	const nextOffset = data.nextOffset == null ? null : Number(data.nextOffset);
	if (
		![limit, offset].every(Number.isSafeInteger) ||
		(nextOffset !== null &&
			(!Number.isSafeInteger(nextOffset) || nextOffset <= offset))
	)
		throw new Error('The data service returned invalid pagination.');
	return {
		entity: entityText(data, 'entity'),
		rows: rawRows as readonly EntityRecord[],
		limit,
		offset,
		nextOffset,
		window: { minLedger, maxLedger },
		coverage: recordValue(data.coverage),
		coverageStatus: entityText(data, 'coverageStatus'),
		semantics: entityText(data, 'semantics')
	};
}
export async function requestExplorerJson(
	path: string,
	signal: AbortSignal
): Promise<unknown> {
	const response = await fetch(path, {
		headers: { accept: 'application/json' },
		credentials: 'omit',
		signal
	});
	const body: unknown = await response.json();
	if (!response.ok) {
		const details = recordValue(body);
		throw new Error(
			'HTTP ' +
				response.status +
				': ' +
				(entityText(details, 'error') ||
					entityText(details, 'message') ||
					'The query could not be completed.')
		);
	}
	return body;
}

export function normalizeWarehouseTimestamp(value: string): string {
	const parsed = value.match(
		/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/
	);
	return parsed
		? parsed[1] +
				'T' +
				parsed[2] +
				'.' +
				(parsed[3] ?? '').padEnd(3, '0').slice(0, 3) +
				'Z'
		: value;
}
