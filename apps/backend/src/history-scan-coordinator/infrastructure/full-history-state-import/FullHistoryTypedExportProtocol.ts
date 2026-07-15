export const FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES = 1 << 20;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface FullHistoryTypedExportProtocol<
	D extends string,
	V extends string,
	T
> {
	readonly dataset: D;
	readonly expectedSourceSha256: string;
	readonly label: string;
	readonly parseValue: (value: unknown) => T;
	readonly version: V;
}

export interface FullHistoryTypedExportResult {
	readonly recordCount: bigint;
	readonly sourceSha256: string;
}

export type FullHistoryTypedExportEvent<D extends string, V extends string, T> =
	| {
			readonly dataset: D;
			readonly sourceSha256: string;
			readonly type: 'header';
			readonly version: V;
	  }
	| { readonly dataset: D; readonly type: 'row'; readonly value: T }
	| {
			readonly dataset: D;
			readonly recordCount: string;
			readonly type: 'complete';
	  };

export class FullHistoryTypedExportSession<
	D extends string,
	V extends string,
	T
> {
	private observedRows = 0n;
	private phase: 'awaiting-header' | 'rows' | 'complete' = 'awaiting-header';
	private sourceSha256: string | null = null;

	constructor(
		private readonly protocol: FullHistoryTypedExportProtocol<D, V, T>
	) {}

	acceptLine(line: string): T | null {
		const event = parseFullHistoryTypedExportLine(line, this.protocol);
		if (event.type === 'header') {
			if (this.phase !== 'awaiting-header') {
				throw new Error(
					`${this.protocol.label} emitted a duplicate or late header`
				);
			}
			if (event.sourceSha256 !== this.protocol.expectedSourceSha256) {
				throw new Error(
					`${this.protocol.label} source digest does not match its manifest`
				);
			}
			this.sourceSha256 = event.sourceSha256;
			this.phase = 'rows';
			return null;
		}
		if (event.type === 'row') {
			if (this.phase !== 'rows') {
				throw new Error(
					`${this.protocol.label} emitted a row outside its row stream`
				);
			}
			this.observedRows += 1n;
			return event.value;
		}
		if (this.phase !== 'rows') {
			throw new Error(
				`${this.protocol.label} emitted completion outside its row stream`
			);
		}
		if (BigInt(event.recordCount) !== this.observedRows) {
			throw new Error(
				`${this.protocol.label} completion count does not match its rows`
			);
		}
		this.phase = 'complete';
		return null;
	}

	finish(): FullHistoryTypedExportResult {
		if (this.phase !== 'complete' || this.sourceSha256 === null) {
			throw new Error(
				`${this.protocol.label} closed before a valid completion event`
			);
		}
		return Object.freeze({
			recordCount: this.observedRows,
			sourceSha256: this.sourceSha256
		});
	}
}

export function parseFullHistoryTypedExportLine<
	D extends string,
	V extends string,
	T
>(
	line: string,
	protocol: FullHistoryTypedExportProtocol<D, V, T>
): FullHistoryTypedExportEvent<D, V, T> {
	validateLine(line, protocol.label);
	let parsed: unknown;
	try {
		parsed = JSON.parse(line) as unknown;
	} catch (error) {
		throw new TypeError(`${protocol.label} emitted invalid JSON`, {
			cause: error
		});
	}
	const record = readRecord(parsed, protocol.label);
	const type = readString(record, 'type', protocol.label);
	if (type === 'header') return parseHeader(record, protocol);
	if (type === 'row') return parseRow(record, protocol);
	if (type === 'complete') return parseComplete(record, protocol);
	throw new TypeError(`${protocol.label} emitted an unknown event type`);
}

function validateLine(line: string, label: string): void {
	if (
		line.length === 0 ||
		line.includes('\n') ||
		line.includes('\r') ||
		Buffer.byteLength(line, 'utf8') >
			FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES
	) {
		throw new TypeError(`${label} emitted an invalid NDJSON line`);
	}
}

function parseHeader<D extends string, V extends string, T>(
	record: JsonRecord,
	protocol: FullHistoryTypedExportProtocol<D, V, T>
): FullHistoryTypedExportEvent<D, V, T> {
	assertExactKeys(
		record,
		['dataset', 'sourceSha256', 'type', 'version'],
		protocol.label
	);
	assertDataset(record, protocol);
	if (readString(record, 'version', protocol.label) !== protocol.version) {
		throw new TypeError(`${protocol.label} protocol version is unsupported`);
	}
	const sourceSha256 = readString(record, 'sourceSha256', protocol.label);
	if (!/^[0-9a-f]{64}$/.test(sourceSha256)) {
		throw new TypeError(
			`${protocol.label} sourceSha256 must be 64 lowercase hexadecimal characters`
		);
	}
	return Object.freeze({
		dataset: protocol.dataset,
		sourceSha256,
		type: 'header' as const,
		version: protocol.version
	});
}

function parseRow<D extends string, V extends string, T>(
	record: JsonRecord,
	protocol: FullHistoryTypedExportProtocol<D, V, T>
): FullHistoryTypedExportEvent<D, V, T> {
	assertExactKeys(record, ['dataset', 'type', 'value'], protocol.label);
	assertDataset(record, protocol);
	return Object.freeze({
		dataset: protocol.dataset,
		type: 'row' as const,
		value: protocol.parseValue(record.value)
	});
}

function parseComplete<D extends string, V extends string, T>(
	record: JsonRecord,
	protocol: FullHistoryTypedExportProtocol<D, V, T>
): FullHistoryTypedExportEvent<D, V, T> {
	assertExactKeys(record, ['dataset', 'recordCount', 'type'], protocol.label);
	assertDataset(record, protocol);
	const recordCount = readString(record, 'recordCount', protocol.label);
	if (!/^(0|[1-9][0-9]*)$/.test(recordCount)) {
		throw new TypeError(
			`${protocol.label} recordCount must be canonical decimal`
		);
	}
	return Object.freeze({
		dataset: protocol.dataset,
		recordCount,
		type: 'complete' as const
	});
}

function readRecord(value: unknown, label: string): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} event must be an object`);
	}
	return value as JsonRecord;
}

function assertExactKeys(
	record: JsonRecord,
	expected: readonly string[],
	label: string
): void {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	) {
		throw new TypeError(`${label} event has an unexpected field set`);
	}
}

function assertDataset<D extends string, V extends string, T>(
	record: JsonRecord,
	protocol: FullHistoryTypedExportProtocol<D, V, T>
): void {
	if (readString(record, 'dataset', protocol.label) !== protocol.dataset) {
		throw new TypeError(`${protocol.label} event belongs to another dataset`);
	}
}

function readString(record: JsonRecord, key: string, label: string): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new TypeError(`${label} ${key} must be a string`);
	}
	return value;
}
