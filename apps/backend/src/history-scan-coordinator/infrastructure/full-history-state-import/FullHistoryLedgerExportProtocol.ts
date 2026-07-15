import { FULL_HISTORY_STATE_EXPORT_VERSION } from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import type { FullHistoryLedgerProjection } from '../../domain/full-history-state-import/FullHistoryLedgerProjection.js';
import { parseFullHistoryLedgerProjection } from './FullHistoryLedgerExportValueParser.js';
import { consumeFullHistoryTypedExport } from './FullHistoryTypedExportLineStream.js';
import {
	FullHistoryTypedExportSession,
	type FullHistoryTypedExportResult
} from './FullHistoryTypedExportProtocol.js';

const ledgerDataset = 'ledgers' as const;

export function consumeFullHistoryLedgerExport(
	chunks: AsyncIterable<Uint8Array>,
	expectedSourceSha256: string,
	consumeRow: (row: FullHistoryLedgerProjection) => Promise<void>
): Promise<FullHistoryTypedExportResult> {
	const session = new FullHistoryTypedExportSession({
		dataset: ledgerDataset,
		expectedSourceSha256,
		label: 'Ledger exporter',
		parseValue: parseFullHistoryLedgerProjection,
		version: FULL_HISTORY_STATE_EXPORT_VERSION
	});
	return consumeFullHistoryTypedExport(
		chunks,
		session,
		consumeRow,
		'Ledger exporter'
	);
}
