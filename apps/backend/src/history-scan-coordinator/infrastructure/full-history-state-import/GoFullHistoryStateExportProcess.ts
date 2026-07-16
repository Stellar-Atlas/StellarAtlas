import type {
	FullHistoryStateChange,
	FullHistoryStateDataset
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import { consumeFullHistoryStateExport } from './FullHistoryStateExportLineStream.js';
import type { FullHistoryTypedExportResult } from './FullHistoryTypedExportProtocol.js';
import {
	runGoFullHistoryTypedExport,
	type FullHistoryTypedExportRunner
} from './GoFullHistoryTypedExportProcess.js';

export interface GoFullHistoryStateExportRequest {
	readonly args: readonly string[];
	readonly consumeRow: (row: FullHistoryStateChange) => Promise<void>;
	readonly dataset: FullHistoryStateDataset;
	readonly executablePath: string;
	readonly expectedSourceSha256: string;
	readonly signal: AbortSignal;
	readonly timeoutMilliseconds: number;
}

export function runGoFullHistoryStateExport(
	request: GoFullHistoryStateExportRequest,
	runExport: FullHistoryTypedExportRunner = runGoFullHistoryTypedExport
): Promise<FullHistoryTypedExportResult> {
	return runExport({
		args: request.args,
		consumeOutput: (output) =>
			consumeFullHistoryStateExport(
				output,
				request.dataset,
				request.expectedSourceSha256,
				request.consumeRow
			),
		executablePath: request.executablePath,
		label: 'State exporter',
		signal: request.signal,
		timeoutMilliseconds: request.timeoutMilliseconds
	});
}
