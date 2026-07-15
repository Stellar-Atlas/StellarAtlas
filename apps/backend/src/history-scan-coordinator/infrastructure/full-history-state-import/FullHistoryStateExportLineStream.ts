import type {
	FullHistoryStateChange,
	FullHistoryStateDataset
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import { FullHistoryStateExportSession } from './FullHistoryStateExportProtocol.js';
import { consumeFullHistoryTypedExport } from './FullHistoryTypedExportLineStream.js';
import type { FullHistoryTypedExportResult } from './FullHistoryTypedExportProtocol.js';

export type FullHistoryStateRowConsumer = (
	row: FullHistoryStateChange
) => Promise<void>;

export async function consumeFullHistoryStateExport(
	chunks: AsyncIterable<Uint8Array>,
	dataset: FullHistoryStateDataset,
	expectedSourceSha256: string,
	consumeRow: FullHistoryStateRowConsumer
): Promise<FullHistoryTypedExportResult> {
	const session = new FullHistoryStateExportSession(
		dataset,
		expectedSourceSha256
	);
	return consumeFullHistoryTypedExport(
		chunks,
		session,
		consumeRow,
		'State exporter'
	);
}
