import {
	FULL_HISTORY_STATE_EXPORT_VERSION,
	type FullHistoryStateChange,
	type FullHistoryStateDataset,
	type FullHistoryStateExportComplete,
	type FullHistoryStateExportEvent,
	type FullHistoryStateExportHeader,
	type FullHistoryStateExportRow
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import { parseFullHistoryStateChange } from './FullHistoryStateExportValueParser.js';

export const FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES = 1 << 20;

type JsonRecord = Readonly<Record<string, unknown>>;

export class FullHistoryStateExportSession {
	private observedRows = 0n;
	private phase: 'awaiting-header' | 'rows' | 'complete' = 'awaiting-header';

	constructor(private readonly expectedDataset: FullHistoryStateDataset) {}

	acceptLine(line: string): FullHistoryStateChange | null {
		const event = parseFullHistoryStateExportLine(line, this.expectedDataset);
		if (event.type === 'header') {
			if (this.phase !== 'awaiting-header') {
				throw new Error('State exporter emitted a duplicate or late header');
			}
			this.phase = 'rows';
			return null;
		}
		if (event.type === 'row') {
			if (this.phase !== 'rows') {
				throw new Error('State exporter emitted a row outside its row stream');
			}
			this.observedRows += 1n;
			return event.value;
		}
		if (this.phase !== 'rows') {
			throw new Error(
				'State exporter emitted completion outside its row stream'
			);
		}
		if (BigInt(event.recordCount) !== this.observedRows) {
			throw new Error(
				'State exporter completion count does not match its rows'
			);
		}
		this.phase = 'complete';
		return null;
	}

	finish(): bigint {
		if (this.phase !== 'complete') {
			throw new Error('State exporter closed before a valid completion event');
		}
		return this.observedRows;
	}
}

export function parseFullHistoryStateExportLine(
	line: string,
	expectedDataset: FullHistoryStateDataset
): FullHistoryStateExportEvent {
	if (
		line.length === 0 ||
		line.includes('\n') ||
		line.includes('\r') ||
		Buffer.byteLength(line, 'utf8') >
			FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES
	) {
		throw new TypeError('State exporter emitted an invalid NDJSON line');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line) as unknown;
	} catch (error) {
		throw new TypeError('State exporter emitted invalid JSON', {
			cause: error
		});
	}
	const record = readRecord(parsed);
	const type = readString(record, 'type');
	if (type === 'header') return parseHeader(record, expectedDataset);
	if (type === 'row') return parseRow(record, expectedDataset);
	if (type === 'complete') return parseComplete(record, expectedDataset);
	throw new TypeError('State exporter emitted an unknown event type');
}

function parseHeader(
	record: JsonRecord,
	expectedDataset: FullHistoryStateDataset
): FullHistoryStateExportHeader {
	assertExactKeys(record, ['dataset', 'type', 'version']);
	assertDataset(record, expectedDataset);
	if (readString(record, 'version') !== FULL_HISTORY_STATE_EXPORT_VERSION) {
		throw new TypeError('State exporter protocol version is unsupported');
	}
	return Object.freeze({
		dataset: expectedDataset,
		type: 'header',
		version: FULL_HISTORY_STATE_EXPORT_VERSION
	});
}

function parseRow(
	record: JsonRecord,
	expectedDataset: FullHistoryStateDataset
): FullHistoryStateExportRow {
	assertExactKeys(record, ['dataset', 'type', 'value']);
	assertDataset(record, expectedDataset);
	return Object.freeze({
		dataset: expectedDataset,
		type: 'row',
		value: parseFullHistoryStateChange(expectedDataset, record.value)
	});
}

function parseComplete(
	record: JsonRecord,
	expectedDataset: FullHistoryStateDataset
): FullHistoryStateExportComplete {
	assertExactKeys(record, ['dataset', 'recordCount', 'type']);
	assertDataset(record, expectedDataset);
	const recordCount = readString(record, 'recordCount');
	if (!/^(0|[1-9][0-9]*)$/.test(recordCount)) {
		throw new TypeError('State exporter recordCount must be canonical decimal');
	}
	return Object.freeze({
		dataset: expectedDataset,
		recordCount,
		type: 'complete'
	});
}

function readRecord(value: unknown): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('State exporter event must be an object');
	}
	return value as JsonRecord;
}

function assertExactKeys(
	record: JsonRecord,
	expected: readonly string[]
): void {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	) {
		throw new TypeError('State exporter event has an unexpected field set');
	}
}

function assertDataset(
	record: JsonRecord,
	expectedDataset: FullHistoryStateDataset
): void {
	if (readString(record, 'dataset') !== expectedDataset) {
		throw new TypeError('State exporter event belongs to another dataset');
	}
}

function readString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new TypeError(`State exporter ${key} must be a string`);
	}
	return value;
}
