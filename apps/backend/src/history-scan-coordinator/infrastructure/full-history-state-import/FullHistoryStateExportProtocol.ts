import {
	FULL_HISTORY_STATE_EXPORT_VERSION,
	type FullHistoryStateChange,
	type FullHistoryStateDataset,
	type FullHistoryStateExportEvent
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import { parseFullHistoryStateChange } from './FullHistoryStateExportValueParser.js';
import {
	FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES,
	FullHistoryTypedExportSession,
	parseFullHistoryTypedExportLine
} from './FullHistoryTypedExportProtocol.js';

export const FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES =
	FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES;

export class FullHistoryStateExportSession extends FullHistoryTypedExportSession<
	FullHistoryStateDataset,
	typeof FULL_HISTORY_STATE_EXPORT_VERSION,
	FullHistoryStateChange
> {
	constructor(
		expectedDataset: FullHistoryStateDataset,
		expectedSourceSha256: string
	) {
		super(stateProtocol(expectedDataset, expectedSourceSha256));
	}
}

export function parseFullHistoryStateExportLine(
	line: string,
	expectedDataset: FullHistoryStateDataset,
	expectedSourceSha256: string
): FullHistoryStateExportEvent {
	return parseFullHistoryTypedExportLine(
		line,
		stateProtocol(expectedDataset, expectedSourceSha256)
	);
}

function stateProtocol(
	expectedDataset: FullHistoryStateDataset,
	expectedSourceSha256: string
): {
	readonly dataset: FullHistoryStateDataset;
	readonly expectedSourceSha256: string;
	readonly label: string;
	readonly parseValue: (value: unknown) => FullHistoryStateChange;
	readonly version: typeof FULL_HISTORY_STATE_EXPORT_VERSION;
} {
	return {
		dataset: expectedDataset,
		expectedSourceSha256,
		label: 'State exporter',
		parseValue: (value) => parseFullHistoryStateChange(expectedDataset, value),
		version: FULL_HISTORY_STATE_EXPORT_VERSION
	};
}
